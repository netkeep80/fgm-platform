#pragma once

#include <cstddef>
#include <limits>
#include <span>
#include <string>
#include <string_view>

namespace fgmr {
inline constexpr std::size_t whole_build_source_limit = 1024 * 1024;
inline constexpr std::size_t whole_build_min_cells = 2;
inline constexpr std::size_t whole_build_max_cells = 8;

struct WholeBuildSource {
    std::string_view bytes;
    std::string_view expected_sha256;
};

struct WholeBuildResult {
    std::string package;
    std::string slices;
    std::string preview;
    std::string report;
    std::string input_proof;
};

struct WholeBuildLimits {
    std::size_t boxes = 8192;
    std::size_t preview_bytes = std::numeric_limits<std::size_t>::max();
};

// The caller supplies independently obtained hashes and is responsible for source attestation.
WholeBuildResult build_whole_object(WholeBuildSource membership,
                                    std::span<const WholeBuildSource> lofts,
                                    std::string_view material,
                                    WholeBuildLimits limits = {});
} // namespace fgmr
