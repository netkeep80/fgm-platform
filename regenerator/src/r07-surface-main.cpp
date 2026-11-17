// R07-S1A: opt-in continuous FGM surface observation. Existing R05/C05 are unchanged.
// Finite-step ray hits are approximate: thin unsampled features remain UNRESOLVED.
#include "model-occupancy.hpp"
#include "projection.hpp"
#include "sha256.hpp"

#include <fgm/evaluator.hpp>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
using Json = nlohmann::json;
constexpr std::size_t request_limit = 128 * 1024;
constexpr std::size_t max_rays = 32 * 40;
constexpr std::size_t max_samples = 200000;
constexpr double max_step = 0.125;
const char* schema = "fgmr-r07-surface-request/1";

void require(bool ok, const char* reason) {
    if (!ok) throw std::runtime_error(reason);
}

bool fields(const Json& value, std::initializer_list<std::string_view> keys) {
    if (!value.is_object() || value.size() != keys.size()) return false;
    for (const auto key : keys) if (!value.contains(std::string(key))) return false;
    return true;
}

int integer(const Json& value, int lower, int upper) {
    require(value.is_number_integer(), "E_S1A_INTEGER");
    const auto n = value.get<std::int64_t>();
    require(n >= lower && n <= upper, "E_S1A_RANGE");
    return static_cast<int>(n);
}

template<std::size_t N>
std::array<int, N> coordinates(const Json& value, int lower, int upper) {
    require(value.is_array() && value.size() == N, "E_S1A_COORDINATES");
    std::array<int,N> result{};
    for (std::size_t i = 0; i < N; ++i) result[i] = integer(value[i], lower, upper);
    return result;
}

std::string request_text() {
    std::string text;
    text.reserve(4096);
    char ch{};
    while (std::cin.get(ch)) {
        require(text.size() < request_limit, "E_S1A_LIMIT");
        text.push_back(ch);
    }
    require(!std::cin.bad() && !text.empty(), "E_S1A_INPUT");
    return text;
}

r03::Rows read_rows(const Json& value) {
    r03::Rows rows{};
    require(value.is_array() && value.size() == rows.size(), "E_S1A_LOFT_ROWS");
    for (std::size_t i = 0; i < rows.size(); ++i)
        rows[i] = static_cast<std::uint16_t>(integer(value[i], 0, 65535));
    return rows;
}

Json pixel_array(const r05::Mask& mask) {
    auto result = Json::array();
    for (const auto& pixel : mask) result.push_back(Json::array({pixel.x, pixel.y}));
    return result;
}

struct Raster {
    r05::Mask mask;
    std::size_t rays = 0, samples = 0;
};

// Affine R05 camera, voxel-unit coordinates:
// sx = tile_anchor.x + 16 + X - Y
// sy = tile_anchor.y + 20 + (X+Y)/2 - Z
// Its kernel is (1,1,1). Target pixel *centers* are (pixel_x+.5,pixel_y+.5).
// Do not replace this with integer R05's truncation (which rounds differently).
Raster raster_surface(const fgm::Evaluator& model, std::string_view material,
                      r05::Point tile, r05::Offset camera, unsigned p_level,
                      bool right_half) {
    const auto anchor = r05::tileAnchor(tile, camera);
    const auto sprite = r05::spriteAnchor(tile, static_cast<std::uint8_t>(p_level), camera);
    Raster raster;
    for (int py = 0; py < 40; ++py) {
        for (int px = right_half ? 16 : 0; px < 32; ++px) {
            const double sx = static_cast<double>(sprite.x) + px + 0.5;
            const double sy = static_cast<double>(sprite.y) + py + 0.5;
            const double d = sx - static_cast<double>(anchor.x) - 16.0;
            const double h = sy - static_cast<double>(anchor.y) - 20.0;
            // Ray: (X,Y,Z)=(t,t-d,t-d/2-h), clipped to [0,16]^2 x [0,24].
            const double lo = std::max({0.0, d, d / 2.0 + h});
            const double hi = std::min({16.0, 16.0 + d, 24.0 + d / 2.0 + h});
            ++raster.rays;
            if (hi <= lo) continue;
            const auto steps = static_cast<std::size_t>(std::ceil((hi-lo)/max_step));
            require(steps <= 128, "E_S1A_LIMIT");
            bool hit = false;
            for (std::size_t i = 0; i <= steps; ++i) {
                require(raster.samples < max_samples, "E_S1A_LIMIT");
                ++raster.samples;
                const double t = lo + (hi-lo)*static_cast<double>(i)/static_cast<double>(steps);
                const auto probe = model.sample_local({t, t-d, t-d/2.0-h});
                if (probe.value < 0) {
                    require(probe.material && *probe.material == material, "E_S1A_MATERIAL");
                    hit = true;
                    break;
                }
            }
            if (hit) raster.mask.insert({sprite.x + px, sprite.y + py});
        }
    }
    require(raster.rays <= max_rays && raster.samples <= max_samples, "E_S1A_LIMIT");
    return raster;
}

Json execute(const Json& req) {
    require(fields(req, {"schema","package","package_sha256","reference_rows",
                         "material","tile","camera_offset","p_level","right_half"}),
            "E_S1A_REQUEST");
    require(req["schema"] == schema, "E_S1A_SCHEMA");
    require(req["package"].is_string() && req["package_sha256"].is_string(),
            "E_S1A_PACKAGE");
    const std::string package = req["package"].get<std::string>();
    const std::string expected_hash = req["package_sha256"].get<std::string>();
    require(!package.empty() && package.size() <= 48*1024 && expected_hash.size() == 64,
            "E_S1A_PACKAGE");
    require(fgmr::sha256(package) == expected_hash, "E_S1A_PACKAGE_SHA");
    const auto ref_rows = read_rows(req["reference_rows"]);
    require(req["material"].is_string(), "E_S1A_MATERIAL");
    const auto material = req["material"].get<std::string>();
    require(!material.empty() && material.size() <= 16 &&
            material[0] >= 'a' && material[0] <= 'z' &&
            std::all_of(material.begin(), material.end(), [](char c) {
                return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
            }), "E_S1A_MATERIAL");
    const auto xyz = coordinates<3>(req["tile"], 0, 254);
    const auto xy = coordinates<2>(req["camera_offset"], -2048, 2048);
    const int p_level = integer(req["p_level"], 0, 255);
    require(req["right_half"].is_boolean(), "E_S1A_RIGHT_HALF");
    const bool right_half = req["right_half"].get<bool>();
    const auto evaluator = fgm::Evaluator::from_package(package);
    const auto occupancy = fgmr::sample_occupancy(evaluator, material);
    require(occupancy.rows == ref_rows, "E_S1A_C05_LOFT_MISMATCH");

    r02::Tile tile{};
    tile.x = xyz[0]; tile.y = xyz[1]; tile.z = xyz[2];
    const r05::Point position{xyz[0],xyz[1],xyz[2]};
    const r05::Offset camera{xy[0],xy[1]};
    const auto old_mask = r05::projectLoft(tile, ref_rows, camera);
    const auto raster = raster_surface(evaluator, material, position, camera,
                                       static_cast<unsigned>(p_level), right_half);
    const auto points = pixel_array(raster.mask);
    const auto loft_points = pixel_array(old_mask);
    const auto tile_anchor = r05::tileAnchor(position, camera);
    const auto sprite_anchor = r05::spriteAnchor(position,
                                         static_cast<std::uint8_t>(p_level), camera);
    return Json{{"schema","fgmr-r07-surface-observation/1"},
        {"model_sha256",expected_hash},
        {"reference_rows_sha256",fgmr::sha256(req["reference_rows"].dump())},
        {"c05",{{"checked",6144},{"match",true},{"material",material},
                 {"scope","voxel_centers_only"}}},
        {"camera",{{"coordinate_frame","r05-ufo-dimetric/1"},
                   {"tile",xyz},{"camera_offset",xy},{"p_level",p_level},
                   {"right_half",right_half},
                   {"tile_anchor",{tile_anchor.x,tile_anchor.y}},
                   {"sprite_anchor",{sprite_anchor.x,sprite_anchor.y}}}},
        {"raster",{{"algorithm","r07-r05-center-rays/1"},
                   {"pixel_center",{0.5,0.5}},{"step_voxels",max_step},
                   {"clip","sprite-32x40-right-half-optional"},
                   {"surface_samples",raster.samples},{"rays",raster.rays},
                   {"completeness","UNRESOLVED_THIN_FEATURES"},
                   {"depth","any-solid-hit-no-depth-output"}}},
        {"loft_mask_sha256",fgmr::sha256(loft_points.dump())},
        {"loft_pixels",old_mask.size()},
        {"surface_mask_sha256",fgmr::sha256(points.dump())},
        {"surface_pixels",raster.mask.size()},
        {"surface_pixels_xy",std::move(points)}};
}
}

int main() {
    try {
        const auto request = Json::parse(request_text());
        std::cout << execute(request).dump() << '\n';
        return std::cout ? 0 : 2;
    } catch (const std::exception& e) {
        const std::string reason = e.what();
        const bool known = reason.starts_with("E_S1A_");
        std::cerr << "R07-S1A: " << (known ? reason : "E_S1A_INVALID_MODEL_OR_INPUT") << '\n';
        return 2;
    }
}
