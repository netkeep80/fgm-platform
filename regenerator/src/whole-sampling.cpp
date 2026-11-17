#include "whole-sampling.hpp"
#include <fgm/evaluator.hpp>
#include <nlohmann/json.hpp>

#include <cstddef>
#include <cstdint>
#include <set>
#include <stdexcept>
#include <string>

namespace fgmr {
namespace {
using Json = nlohmann::json;
void require(bool ok) {
    if (!ok) throw std::runtime_error("E_S43_WHOLE_INPUT");
}
bool valid_material(std::string_view value) {
    if (value.empty() || value.size() > 80 || value.front() < 'a' || value.front() > 'z')
        return false;
    for (char ch : value)
        if (!((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_'))
            return false;
    return true;
}
} // namespace

std::string sample_whole(std::string_view bytes, std::string_view material,
                         const std::vector<std::array<int,3>>& local_cells) {
    require(!bytes.empty() && bytes.size() <= 4U * 1024 * 1024);
    require(valid_material(material) && local_cells.size() >= 2 && local_cells.size() <= 8);
    std::set<std::array<int,3>> seen;
    for (const auto& cell : local_cells) {
        for (auto coord : cell) require(coord >= -16 && coord <= 16);
        require(seen.insert(cell).second);
    }
    const auto model = fgm::Evaluator::from_package(std::string(bytes));
    Json cells = Json::array();
    for (const auto& local : local_cells) {
        std::string mask;
        mask.reserve(16 * 16 * 24);
        for (int z = 0; z < 24; ++z) {
            for (int y = 0; y < 16; ++y) {
                for (int x = 0; x < 16; ++x) {
                    const auto probe = model.sample_local({
                        double(local[0] * 16 + x) + 0.5,
                        double(local[1] * 16 + y) + 0.5,
                        double(local[2] * 24 + z) + 0.5});
                    const bool hit = probe.value < 0;
                    if (hit) require(probe.material && *probe.material == material);
                    mask.push_back(hit ? '1' : '0');
                }
            }
        }
        cells.push_back({{"local_xyz", local}, {"mask", std::move(mask)}});
    }
    return Json{{"schema","fgm-regenerator/whole-object-sampling-v1"},
                {"cells",std::move(cells)}}.dump();
}
} // namespace fgmr
