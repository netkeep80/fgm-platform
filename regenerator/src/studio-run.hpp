#pragma once

#include "model-occupancy.hpp"
#include "studio-cell.hpp"
#include "whole-build.hpp"

#include <cstdint>
#include <optional>
#include <vector>

namespace fgmr::studio {
inline constexpr std::size_t max_request = 128*1024;

struct BuildBinding { std::string file, sha256; };
struct BuildSpec {
    BuildBinding receipt;
    std::vector<BuildBinding> lofts;
};

class Runner {
public:
    std::string call(std::string_view request);

private:
    enum class State { ready, running, paused, completed, failed, cancelled };
    struct RunSpec {
        std::string package, seed, material;
        std::optional<CellSpec> cell;
        Files files;
        std::vector<std::array<int,3>> whole_cells{};
        bool whole = false;
        std::optional<BuildSpec> build{};
    };

    State state_ = State::ready;
    std::uint32_t run_id_ = 0;
    RunSpec spec_;
    Occupancy result_;
    std::string whole_result_;
    std::optional<CellResult> cell_result_;
    std::optional<WholeBuildResult> build_result_;
    Files staged_;
    std::size_t staged_size_ = 0;
};
}
