#include "model-occupancy.hpp"

namespace fgmr {
Occupancy sample_occupancy(const fgm::Evaluator& model, std::string_view material) {
    Occupancy result;
    result.mask.reserve(voxel_count);
    for (std::size_t z = 0; z < r03::kHeight; ++z) {
        for (std::size_t y = 0; y < r03::kSide; ++y) {
            for (std::size_t x = 0; x < r03::kSide; ++x) {
                const auto probe = model.sample_local({
                    static_cast<double>(x)+0.5, static_cast<double>(y)+0.5, static_cast<double>(z)+0.5});
                const bool occupied = probe.value < 0;
                if (occupied) {
                    if (!probe.material || *probe.material != material) throw fgm::Error("E_R06_MATERIAL");
                    result.rows[z*r03::kSide+y] |= static_cast<std::uint16_t>(1U << (r03::kSide-1-x));
                    ++result.occupied;
                }
                result.mask.push_back(occupied ? '1' : '0');
            }
        }
    }
    return result;
}
}
