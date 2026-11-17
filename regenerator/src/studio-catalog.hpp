#pragma once

#include "studio-cell.hpp"

#include <nlohmann/json_fwd.hpp>

namespace fgmr::studio {
struct CatalogError { const char* code; };
nlohmann::json catalog_directory(const nlohmann::json& paths);
nlohmann::json catalog_map(std::string_view map_id, const Files& files);
} // namespace fgmr::studio
