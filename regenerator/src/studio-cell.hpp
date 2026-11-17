#pragma once

#include "map-facts.hpp"

#include <array>
#include <map>
#include <string_view>
#include <vector>

namespace fgmr::studio {
struct DatasetBinding { std::string id, file; };

struct CellSpec {
    std::string map, loft, sprite_dataset, pck, tab, palette;
    std::vector<DatasetBinding> datasets;
    std::array<int, 3> tile{};
    std::size_t part = 0, slot = 0, palette_index = 0;
    unsigned tab_bits = 0;
    std::string material;
};

using Files = std::map<std::string,r02::Bytes,std::less<>>;

struct CellResult { std::string model, preview, report, proof, visual; };
struct CellError { const char* code; };
CellResult reconstruct_cell(const CellSpec&, const Files&);
} // namespace fgmr::studio
