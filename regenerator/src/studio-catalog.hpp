#pragma once

#include "studio-cell.hpp"

#include <nlohmann/json_fwd.hpp>

namespace fgmr::studio {
struct CatalogError { const char* code; };
nlohmann::json catalog_directory(const nlohmann::json& paths);
nlohmann::json catalog_map(std::string_view map_id, const Files& files);
// R02-derived, digest-bound, deterministic and page-limited source occurrences.
nlohmann::json catalog_placements(std::string_view map_id, const Files& files,
                                  unsigned floor, std::size_t offset, std::size_t limit,
                                  std::string_view expected_digest);
// Bounded indexed original R04 sprites from the chosen local terrain data only.
nlohmann::json catalog_thumbnails(std::string_view dataset, const Files& files,
                                  const nlohmann::json& records, unsigned slot,
                                  unsigned tab_bits, std::size_t palette_index);
} // namespace fgmr::studio
