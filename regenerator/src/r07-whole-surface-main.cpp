// R07-S1B1B0: shared-canonical FGM surface observer for 2..8 verified cells.
// Hard all-cell C05 precedes every pixel result; original UFO assets never shipped.
#include "projection.hpp"
#include "sha256.hpp"
#include "whole-sampling.hpp"

#include <fgm/evaluator.hpp>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {
using Json = nlohmann::json;
constexpr std::size_t max_input_bytes = 5 * 1024 * 1024;
constexpr std::size_t max_package_bytes = 4 * 1024 * 1024;
constexpr double max_step = 0.125;
constexpr std::size_t max_samples_per_cell = 200000;
constexpr const char* request_schema = "fgmr-r07-whole-surface-request/1";
constexpr const char* output_schema = "fgmr-r07-whole-surface-observation/1";

void require(bool ok, const char* why) {
    if (!ok) throw std::runtime_error(why);
}
bool fields(const Json& obj, std::initializer_list<std::string_view> keys) {
    if (!obj.is_object() || obj.size() != keys.size()) return false;
    for (auto key : keys) if (!obj.contains(std::string(key))) return false;
    return true;
}
int integer(const Json& value, int lo, int hi) {
    require(value.is_number_integer(), "E_B0_INTEGER");
    const auto v = value.get<std::int64_t>();
    require(v >= lo && v <= hi, "E_B0_RANGE");
    return static_cast<int>(v);
}
template<std::size_t N>
std::array<int,N> coords(const Json& value, int lo, int hi) {
    require(value.is_array() && value.size() == N, "E_B0_COORDINATES");
    std::array<int,N> out{};
    for (std::size_t i = 0; i < N; ++i) out[i] = integer(value[i], lo, hi);
    return out;
}
std::string read_stdin() {
    std::string data;
    data.reserve(8192);
    char ch{};
    while (std::cin.get(ch)) {
        require(data.size() < max_input_bytes, "E_B0_INPUT_LIMIT");
        data.push_back(ch);
    }
    require(!data.empty() && !std::cin.bad(), "E_B0_INPUT");
    return data;
}
struct Cell {
    std::array<int,3> world{}, local{};
    std::array<std::uint16_t,384> reference{};
    int p_level = 0;
    bool right_half = false;
};
Cell parse_cell(const Json& value) {
    require(fields(value, {"tile","local_xyz","reference_rows","p_level","right_half"}),
            "E_B0_CELL");
    Cell cell;
    cell.world = coords<3>(value["tile"], 0, 254);
    cell.local = coords<3>(value["local_xyz"], -16, 16);
    require(value["reference_rows"].is_array() &&
            value["reference_rows"].size() == cell.reference.size(), "E_B0_ROWS");
    for (std::size_t i = 0; i < cell.reference.size(); ++i) {
        cell.reference[i] = static_cast<std::uint16_t>(
            integer(value["reference_rows"][i], 0, 65535));
    }
    cell.p_level = integer(value["p_level"], 0, 255);
    require(value["right_half"].is_boolean(), "E_B0_HALF");
    cell.right_half = value["right_half"].get<bool>();
    return cell;
}
std::string expected_mask(const Cell& cell) {
    std::string result;
    result.reserve(6144);
    for (std::size_t z = 0; z < 24; ++z)
        for (std::size_t y = 0; y < 16; ++y)
            for (std::size_t x = 0; x < 16; ++x)
                result.push_back((cell.reference[z*16+y] &
                                  (1U << (15U-static_cast<unsigned>(x)))) ? '1' : '0');
    return result;
}
struct Raster {
    r05::Mask pixels;
    std::size_t rays = 0, samples = 0;
};
// R05 affine original tile-space camera. The field is evaluated in the ONE
// whole-object local basis (16,16,24) * local_xyz + cell-local ray point.
Raster raster_cell(const fgm::Evaluator& model, std::string_view material,
                   const Cell& cell) {
    const r05::Point world{cell.world[0], cell.world[1], cell.world[2]};
    const auto anchor = r05::tileAnchor(world);
    const auto sprite = r05::spriteAnchor(world, static_cast<std::uint8_t>(cell.p_level));
    const auto shift_x = 16.0 * cell.local[0];
    const auto shift_y = 16.0 * cell.local[1];
    const auto shift_z = 24.0 * cell.local[2];
    Raster result;
    for (int py = 0; py < 40; ++py) {
        for (int px = cell.right_half ? 16 : 0; px < 32; ++px) {
            const double sx = static_cast<double>(sprite.x) + px + 0.5;
            const double sy = static_cast<double>(sprite.y) + py + 0.5;
            const double d = sx - static_cast<double>(anchor.x) - 16.0;
            const double h = sy - static_cast<double>(anchor.y) - 20.0;
            const double lo = std::max({0.0, d, d/2.0 + h});
            const double hi = std::min({16.0, 16.0 + d, 24.0 + d/2.0 + h});
            ++result.rays;
            if (hi <= lo) continue;
            const auto steps = static_cast<std::size_t>(std::ceil((hi-lo)/max_step));
            require(steps > 0 && steps <= 128, "E_B0_RAY_LIMIT");
            bool hit = false;
            for (std::size_t i = 0; i <= steps; ++i) {
                require(result.samples < max_samples_per_cell, "E_B0_RAY_LIMIT");
                ++result.samples;
                const double t = lo + (hi-lo)*static_cast<double>(i)/static_cast<double>(steps);
                const auto sample = model.sample_local({shift_x+t, shift_y+t-d,
                                                        shift_z+t-d/2.0-h});
                if (sample.value < 0) {
                    require(sample.material && *sample.material == material, "E_B0_MATERIAL");
                    hit = true;
                    break;
                }
            }
            if (hit) result.pixels.insert({sprite.x+px, sprite.y+py});
        }
    }
    require(result.rays <= 1280 && result.samples <= max_samples_per_cell,
            "E_B0_RAY_LIMIT");
    return result;
}
Json pixels_json(const r05::Mask& value) {
    Json result = Json::array();
    for (const auto& p : value) result.push_back(Json::array({p.x,p.y}));
    return result;
}
Json execute(const Json& request) {
    require(fields(request, {"schema","package","package_sha256","material","cells"}),
            "E_B0_REQUEST");
    require(request["schema"] == request_schema, "E_B0_SCHEMA");
    require(request["package"].is_string() && request["package_sha256"].is_string(),
            "E_B0_PACKAGE");
    const auto package = request["package"].get<std::string>();
    const auto digest = request["package_sha256"].get<std::string>();
    require(!package.empty() && package.size() <= max_package_bytes &&
            digest.size() == 64 && fgmr::sha256(package) == digest, "E_B0_PACKAGE_SHA");
    require(request["material"].is_string(), "E_B0_MATERIAL");
    const auto material = request["material"].get<std::string>();
    require(!material.empty() && material.size() <= 16 && material.front() >= 'a' &&
            material.front() <= 'z' &&
            std::all_of(material.begin(), material.end(), [](char ch) {
                return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_';
            }), "E_B0_MATERIAL");
    require(request["cells"].is_array() && request["cells"].size() >= 2 &&
            request["cells"].size() <= 8, "E_B0_SCOPE");
    std::vector<Cell> cells;
    std::vector<std::array<int,3>> local;
    std::set<std::array<int,3>> seen_local, seen_world;
    cells.reserve(request["cells"].size());
    std::array<int,3> expected_anchor{};
    bool have_anchor = false;
    for (const auto& entry : request["cells"]) {
        auto cell = parse_cell(entry);
        require(seen_local.insert(cell.local).second &&
                seen_world.insert(cell.world).second, "E_B0_DUPLICATE_CELL");
        const std::array<int,3> anchor{cell.world[0]-cell.local[0],
                                       cell.world[1]-cell.local[1],
                                       cell.world[2]-cell.local[2]};
        if (!have_anchor) {expected_anchor = anchor; have_anchor = true;}
        else require(anchor == expected_anchor, "E_B0_INCONSISTENT_ANCHOR");
        local.push_back(cell.local);
        cells.push_back(cell);
    }

    // Reuse the ACCEPTED R06-S2B2 whole-object sampler: identical core
    // evaluator, grid order and material semantics, NOT a second C05 in Python.
    const Json sampled = Json::parse(fgmr::sample_whole(package, material, local));
    require(fields(sampled, {"schema","cells"}) &&
            sampled["schema"] == "fgm-regenerator/whole-object-sampling-v1" &&
            sampled["cells"].is_array() && sampled["cells"].size() == cells.size(),
            "E_B0_C05_PROTOCOL");
    // No rasterization or partial result before all 6144*n C05 centers pass.
    for (std::size_t i = 0; i < cells.size(); ++i) {
        const auto& check = sampled["cells"][i];
        require(fields(check, {"local_xyz","mask"}) && check["mask"].is_string() &&
                check["local_xyz"] == local[i], "E_B0_C05_PROTOCOL");
        const auto mask = check["mask"].get<std::string>();
        require(mask.size() == 6144 &&
                std::all_of(mask.begin(), mask.end(), [](char x){return x=='0'||x=='1';}),
                "E_B0_C05_PROTOCOL");
        require(mask == expected_mask(cells[i]), "E_B0_C05_ALL_CELLS_MISMATCH");
    }

    const auto model = fgm::Evaluator::from_package(package);
    Json results = Json::array();
    for (std::size_t i = 0; i < cells.size(); ++i) {
        const auto& cell = cells[i];
        const auto ray = raster_cell(model, material, cell);
        const auto pixels = pixels_json(ray.pixels);
        const auto ref = request["cells"][i]["reference_rows"].dump();
        results.push_back({{"tile",cell.world},{"local_xyz",cell.local},
                           {"reference_rows_sha256",fgmr::sha256(ref)},
                           {"c05_checked",6144},{"surface_pixels",ray.pixels.size()},
                           {"surface_pixels_xy",pixels},{"surface_mask_sha256",fgmr::sha256(pixels.dump())},
                           {"rays",ray.rays},{"surface_samples",ray.samples}});
    }
    return Json{{"schema",output_schema},{"model_sha256",digest},
                {"material",material},
                {"c05",{{"checked",cells.size()*6144},{"match",true},
                         {"scope","voxel_centers_only"}}},
                {"raster",{{"algorithm","r07-whole-cell-center-rays/1"},
                           {"r05_camera","r05-ufo-dimetric/1"},
                           {"step_voxels",max_step},
                           {"completeness","UNRESOLVED_THIN_FEATURES_AND_CROSS_CELL_OCCLUSION"}}},
                {"cells",std::move(results)}};
}
} // namespace

int main() {
    try {
        const auto request = Json::parse(read_stdin());
        std::cout << execute(request).dump() << '\n';
        return std::cout ? 0 : 2;
    } catch (const std::exception& e) {
        const std::string reason = e.what();
        const bool known = reason.starts_with("E_B0_");
        std::cerr << "R07-S1B1B0: "
                  << (known ? reason : "E_B0_INVALID_MODEL_OR_INPUT") << '\n';
        return 2;
    }
}
