#pragma once
#include <nlohmann/json.hpp>
namespace fgmr {
// Shared native/WASM R07 observer; all-cell C05 precedes raster output.
nlohmann::json observe_whole(const nlohmann::json& request);
}
