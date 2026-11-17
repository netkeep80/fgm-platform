#include "whole-build.hpp"
#include "sha256.hpp"
#include "whole-sampling.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <tuple>
#include <utility>
#include <vector>

namespace fgmr {
namespace {
using Json = nlohmann::json;
using Point = std::array<int, 3>;
using Voxels = std::set<Point>;
constexpr Point grid{16, 16, 24};
constexpr std::size_t centers_per_cell = 16 * 16 * 24;
constexpr std::array<std::string_view, 4> parts{"floor", "west_wall", "north_wall", "object"};

void require(bool ok, const char* code) {
    if (!ok) throw std::runtime_error(code);
}

bool match_bytes(WholeBuildSource input) {
    require(!input.bytes.empty() && input.bytes.size() <= whole_build_source_limit,
            "E_S43_BUILD_LIMIT");
    return sha256(input.bytes) == input.expected_sha256;
}

std::string canonical(const Json& value) {
    return value.dump(-1, ' ', true);
}

Json parse(std::string_view bytes) {
    using Event = Json::parse_event_t;
    require(bytes.find('\0') == std::string_view::npos, "E_S43_BUILD_JSON");
    std::array<std::set<std::string>, 33> keys;
    try {
        return Json::parse(bytes.begin(), bytes.end(), [&](int depth, Event event, Json& value) {
            require(depth < 32, "E_S43_BUILD_JSON");
            if (event == Event::object_start) keys.at(static_cast<std::size_t>(depth + 1)).clear();
            if (event == Event::key)
                require(keys.at(static_cast<std::size_t>(depth)).insert(value.get<std::string>()).second,
                        "E_S43_BUILD_JSON");
            return true;
        });
    } catch (const Json::exception&) {
        throw std::runtime_error("E_S43_BUILD_JSON");
    }
}

int bounded(const Json& value, int low, int high, const char* error) {
    require(value.is_number_integer(), error);
    if (value.is_number_unsigned()) {
        const auto number = value.get<std::uint64_t>();
        require(number <= static_cast<std::uint64_t>(high)
                    && (low <= 0 || number >= static_cast<std::uint64_t>(low)), error);
        return static_cast<int>(number);
    }
    const auto number = value.get<std::int64_t>();
    require(number >= low && number <= high, error);
    return static_cast<int>(number);
}

Point coordinates(const Json& value, int low, int high) {
    require(value.is_array() && value.size() == 3, "E_S43_BUILD_BINDING");
    Point point{};
    for (std::size_t axis = 0; axis < point.size(); ++axis)
        point[axis] = bounded(value[axis], low, high, "E_S43_BUILD_BINDING");
    return point;
}

Point add(const Point& point, const Point& offset) {
    return {point[0]+offset[0], point[1]+offset[1], point[2]+offset[2]};
}

bool small_identifier(std::string_view value, bool material) {
    if (value.empty() || value.size() > 80 || (material && (value[0] < 'a' || value[0] > 'z')))
        return false;
    return std::ranges::all_of(value, [material](char c) {
        return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_'
            || (!material && ((c >= 'A' && c <= 'Z') || c == '.' || c == '-'));
    });
}

struct Binding {
    Point xyz, local;
    std::size_t part;
    std::string dataset;
    int record, map_record;
};

std::map<Point, Binding> bindings(const Json& receipt) {
    require(receipt.is_object() && receipt.value("schema", "") == "fgm-regenerator/verified-membership-input-v1"
                && receipt.value("status", "") == "verified_explicit_membership"
                && receipt.at("instance").is_string() && receipt.at("prototype").is_string()
                && receipt.at("provenance").is_object(), "E_S43_BUILD_MEMBERSHIP");
    const auto anchor = coordinates(receipt.at("anchor_xyz"), -255, 254);
    const auto& cells = receipt.at("cell_bindings");
    require(cells.is_array() && cells.size() >= whole_build_min_cells
                             && cells.size() <= whole_build_max_cells, "E_S43_BUILD_SCOPE");
    std::map<Point, Binding> result;
    for (const auto& cell : cells) {
        constexpr auto error = "E_S43_BUILD_BINDING";
        const auto xyz = coordinates(cell.at("xyz"), 0, 254);
        const auto local = coordinates(cell.at("local_xyz"), -16, 16);
        require(add(local, anchor) == xyz, error);
        const auto part = std::ranges::find(parts, cell.at("part").get<std::string>());
        const auto dataset = cell.at("dataset").get<std::string>();
        require(part != parts.end() && small_identifier(dataset, false), error);
        const auto record = bounded(cell.at("record"), 0, 65535, error);
        const auto map_record = bounded(cell.at("map_record"), 0, 16777216, error);
        require(result.emplace(xyz, Binding{xyz, local, static_cast<std::size_t>(part-parts.begin()),
                                            dataset, record, map_record}).second, error);
    }
    return result;
}

struct Cell {
    Json rows;
    std::string hash, mask;
    std::size_t occupied;
};

Cell read_cell(const Json& loft, const Binding& binding, std::string_view source_hash, Voxels& whole) {
    const auto& source = loft.at("sources");
    const auto& part_rows = loft.at("part_rows");
    require(source.is_array() && source.size() == parts.size()
                && part_rows.is_array() && part_rows.size() == parts.size(), "E_S43_BUILD_LOFT_LAYOUT");
    const auto& item = source[binding.part];
    constexpr auto error = "E_S43_BUILD_LOFT_BINDING";
    require(item.is_object() && item.value("part", "") == parts[binding.part]
                && item.at("present") == Json(true) && item.value("dataset_label", "") == binding.dataset
                && bounded(item.at("local_index"), 0, 65535, error) == binding.record
                && bounded(loft.at("tile").at("record_index"), 0, 16777216, error) == binding.map_record,
            error);
    const auto& rows = part_rows[binding.part];
    constexpr auto row_error = "E_S43_BUILD_LOFT_ROWS";
    require(rows.is_array() && rows.size() == 24, row_error);
    const Point offset{binding.local[0]*16,binding.local[1]*16,binding.local[2]*24};
    Cell cell{rows, std::string(source_hash), {}, 0};
    cell.mask.reserve(centers_per_cell);
    for (int z = 0; z < 24; ++z) {
        const auto& layer = rows[static_cast<std::size_t>(z)];
        require(layer.is_array() && layer.size() == 16, row_error);
        for (int y = 0; y < 16; ++y) {
            const auto bits = bounded(layer[static_cast<std::size_t>(y)], 0, 65535, row_error);
            for (int x = 0; x < 16; ++x) {
                const bool occupied = (bits & (1 << (15-x))) != 0;
                cell.mask.push_back(occupied ? '1' : '0');
                if (occupied) {
                    require(whole.insert(add({x,y,z}, offset)).second, "E_S43_BUILD_OVERLAP");
                    ++cell.occupied;
                }
            }
        }
    }
    return cell;
}

std::map<Point, Cell> read_cells(std::span<const WholeBuildSource> inputs,
                                  const std::map<Point, Binding>& expected, Voxels& whole) {
    require(inputs.size() == expected.size(), "E_S43_BUILD_LOFT_SET");
    std::map<Point, Cell> result;
    for (const auto& input : inputs) {
        require(match_bytes(input), "E_S43_BUILD_LOFT_SHA");
        const auto loft = parse(input.bytes);
        require(loft.is_object() && loft.value("schema", "") == "fgm-regenerator/loft-terrain-v1"
                    && coordinates(loft.at("voxel_dimensions_xyz"), 1, 24) == grid
                    && loft.at("terrain_only") == Json(true), "E_S43_BUILD_LOFT_LAYOUT");
        const auto xyz = coordinates(loft.at("tile").at("xyz"), 0, 254);
        const auto binding = expected.find(xyz);
        require(binding != expected.end() && !result.contains(xyz), "E_S43_BUILD_LOFT_SET");
        result.emplace(xyz, read_cell(loft, binding->second, input.expected_sha256, whole));
    }
    return result;
}

using Box = std::pair<Point, Point>;
std::vector<Box> boxes(const Voxels& whole, std::size_t max_boxes) {
    auto remaining = whole;
    std::vector<Point> points(whole.begin(), whole.end());
    std::ranges::sort(points, [](const Point& a, const Point& b) {
        return std::tie(a[2], a[1], a[0]) < std::tie(b[2], b[1], b[0]);
    });
    std::vector<Box> result;
    for (const auto& point : points) {
        if (!remaining.contains(point)) continue;
        const auto [x,y,z] = point;
        auto end = add(point, {1,1,1});
        while (remaining.contains({end[0],y,z})) ++end[0];
        const auto row_complete = [&](int row, int layer) {
            for (int col = x; col < end[0]; ++col)
                if (!remaining.contains({col,row,layer})) return false;
            return true;
        };
        while (row_complete(end[1], z)) ++end[1];
        const auto layer_complete = [&](int layer) {
            for (int row = y; row < end[1]; ++row)
                if (!row_complete(row, layer)) return false;
            return true;
        };
        while (layer_complete(end[2])) ++end[2];
        for (int k = z; k < end[2]; ++k)
            for (int j = y; j < end[1]; ++j)
                for (int i = x; i < end[0]; ++i) remaining.erase({i,j,k});
        require(result.size() < max_boxes, "E_S43_BUILD_LIMIT");
        result.emplace_back(point, end);
    }
    return result;
}

Json half(int number) {
    if (number % 2 == 0) return number / 2;
    return double(number) / 2;
}

std::string build_package(const std::vector<Box>& bounds, std::string_view material,
                          std::string_view receipt_hash, const Json& evidence) {
    auto nodes = Json::array();
    std::vector<std::string> level;
    for (std::size_t i = 0; i < bounds.size(); ++i) {
        const auto [begin, end] = bounds[i];
        const auto index = std::to_string(i);
        const auto extent = "extent_" + index, offset = "offset_" + index;
        const auto box = "box_" + index, moved = "move_" + index;
        auto size = Json::array(), center = Json::array();
        for (std::size_t axis = 0; axis < 3; ++axis) {
            size.push_back(half(end[axis]-begin[axis]));
            center.push_back(half(begin[axis]+end[axis]));
        }
        nodes.push_back({{"id",extent},{"op","constant"},{"type","vec3"},{"value",size}});
        nodes.push_back({{"id",offset},{"op","constant"},{"type","vec3"},{"value",center}});
        nodes.push_back({{"id",box},{"op","box"},{"halfSize",extent}});
        nodes.push_back({{"id",moved},{"op","translate"},{"field",box},{"offset",offset}});
        level.push_back(moved);
    }
    std::size_t merge = 0;
    while (level.size() > 1) {
        std::vector<std::string> parents;
        for (std::size_t i = 1; i < level.size(); i += 2) {
            const auto id = "union_" + std::to_string(merge++);
            nodes.push_back({{"id",id},{"op","union"},{"left",level[i-1]},{"right",level[i]}});
            parents.push_back(id);
        }
        if (level.size() % 2) parents.push_back(level.back());
        level = std::move(parents);
    }

    const Json generation{{"algorithm","r06_multicell_loft_boxes"},{"version","0.1.0"},
                           {"parameters",{{"cell_xyz",grid}}},
                           {"resources",{{"membership",receipt_hash},
                                         {"loft_observations",sha256(canonical(evidence))},
                                         {"material_sha256",sha256(canonical(Json(material)))}}}};
    const auto seed = sha256(canonical(Json::array({"fgm:seed:1",{{"generation",generation},{"purpose","model"}}})));
    const Json program{{"version","fgm-0"},{"nodes",std::move(nodes)},{"root",level.front()}};
    const Json field{{"op","program"},{"program",program},{"parameters",Json::object()}};
    const Json contribution{{"id","whole_object"},{"material",material},{"priority",0},{"field",field}};
    auto package = canonical({{"format","fgm-package/1"},{"interpreter","fgm-0/1"},
                              {"generation",generation},
                              {"model",{{"seed",seed},{"volumes",Json::object()},
                                        {"contributions",Json::array({contribution})}}}});
    require(package.size() <= 4U * 1024 * 1024, "E_S43_BUILD_LIMIT");
    return package;
}

std::string mesh(const Voxels& whole, std::size_t limit) {
    struct Face { Point neighbour; std::array<Point,4> corners; };
    constexpr std::array<Face,6> faces{{
        {{-1,0,0}, {{{0,0,0},{0,0,1},{0,1,1},{0,1,0}}}},
        {{1,0,0},  {{{1,0,0},{1,1,0},{1,1,1},{1,0,1}}}},
        {{0,-1,0}, {{{0,0,0},{1,0,0},{1,0,1},{0,0,1}}}},
        {{0,1,0},  {{{0,1,0},{0,1,1},{1,1,1},{1,1,0}}}},
        {{0,0,-1}, {{{0,0,0},{0,1,0},{1,1,0},{1,0,0}}}},
        {{0,0,1},  {{{0,0,1},{1,0,1},{1,1,1},{0,1,1}}}},
    }};
    std::map<Point,std::size_t> indices;
    std::string vertices = "o terrain\n", polygons;
    for (const auto& point : whole) {
        for (const auto& face : faces) {
            if (whole.contains(add(point, face.neighbour))) continue;
            polygons += 'f';
            for (const auto& corner : face.corners) {
                const auto vertex = add(point, corner);
                const auto [entry, inserted] = indices.try_emplace(vertex, indices.size()+1);
                if (inserted)
                    vertices += "v " + std::to_string(vertex[0]) + ' ' + std::to_string(vertex[1])
                                + ' ' + std::to_string(vertex[2]) + '\n';
                polygons += ' ' + std::to_string(entry->second);
            }
            polygons += '\n';
            require(vertices.size()+polygons.size()<=limit,"E_S43_BUILD_LIMIT");
        }
    }
    return vertices + polygons;
}
} // namespace

WholeBuildResult build_whole_object(WholeBuildSource membership,
                                    std::span<const WholeBuildSource> lofts,
                                    std::string_view material, WholeBuildLimits limits) {
    require(small_identifier(material, true), "E_S43_BUILD_MATERIAL");
    require(match_bytes(membership), "E_S43_BUILD_RECEIPT_SHA");
    try {
        const auto receipt = parse(membership.bytes);
        const auto expected = bindings(receipt);
        Voxels whole;
        const auto sources = read_cells(lofts, expected, whole);
        require(!whole.empty(), "E_S43_BUILD_EMPTY");

        auto evidence = Json::array(), slices = Json::array(), hashes = Json::array();
        std::vector<Point> sampling_cells;
        for (const auto& [xyz, binding] : expected) {
            const auto& cell = sources.at(xyz);
            sampling_cells.push_back(binding.local);
            evidence.push_back({{"xyz",xyz},{"part",parts[binding.part]},{"source_sha256",cell.hash},
                                {"occupancy_sha256",sha256(cell.mask)},{"occupied",cell.occupied}});
            slices.push_back({{"xyz",xyz},{"local_xyz",binding.local},{"part",parts[binding.part]},
                              {"rows",cell.rows},{"occupied",cell.occupied}});
            hashes.push_back({{"xyz",xyz},{"sha256",cell.hash}});
        }
        WholeBuildResult result;
        const auto bounds = boxes(whole, std::min(limits.boxes, WholeBuildLimits{}.boxes));
        result.package = build_package(bounds, material, membership.expected_sha256, evidence);
        const auto sampled = parse(sample_whole(result.package, material, sampling_cells));
        std::size_t index = 0;
        for (const auto& [xyz, binding] : expected) {
            const auto& cell = sampled.at("cells").at(index++);
            require(cell.at("local_xyz") == Json(binding.local) && cell.at("mask") == sources.at(xyz).mask,
                    "E_S43_BUILD_C05_MISMATCH");
        }
        result.preview = mesh(whole, limits.preview_bytes);
        result.slices = canonical({{"schema","fgm-regenerator/slice-by-cell-v1"},
                                   {"instance",receipt.at("instance")},{"cells",std::move(slices)}});
        result.report = canonical({{"schema","fgm-regenerator/whole-object-report-v1"},
                                    {"instance",receipt.at("instance")},{"prototype",receipt.at("prototype")},
                                    {"membership_sha256",membership.expected_sha256},
                                    {"model_sha256",sha256(result.package)},{"preview_sha256",sha256(result.preview)},
                                    {"slices_sha256",sha256(result.slices)},{"cell_bindings",evidence},
                                    {"boxes",bounds.size()},{"occupied",whole.size()},
                                    {"checked_centers",expected.size()*centers_per_cell},
                                    {"surface","global_voxel_boundary_no_internal_faces"},
                                    {"scope","static_explicit_single_part_per_tile"}});
        result.input_proof = canonical({{"schema","fgm-regenerator/whole-build-proof-v1"},
                                        {"verification_scope","transport_integrity_binding_c05"},
                                        {"receipt_sha256",membership.expected_sha256},
                                        {"source_hashes",std::move(hashes)},{"reran_b1",false},{"rederived_r03",false},
                                        {"package_sha256",sha256(result.package)}});
        return result;
    } catch (const Json::exception&) {
        throw std::runtime_error("E_S43_BUILD_INPUT");
    }
}
} // namespace fgmr
