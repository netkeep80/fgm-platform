#include "projection.hpp"
#include "model-occupancy.hpp"

#include <fgm/evaluator.hpp>

#include <array>
#include <charconv>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <system_error>

namespace {
namespace fs = std::filesystem;

std::string read(const fs::path& path, std::uintmax_t limit) {
    std::error_code error;
    const auto size = fs::file_size(path, error);
    if (error || size > limit) throw std::runtime_error("E_R06_INPUT");
    std::ifstream stream(path, std::ios::binary);
    if (!stream) throw std::runtime_error("E_R06_INPUT");
    std::string value(static_cast<std::size_t>(size), '\0');
    if (!stream.read(value.data(), static_cast<std::streamsize>(size))
        || stream.peek() != std::char_traits<char>::eof() || stream.bad())
        throw std::runtime_error("E_R06_INPUT");
    return value;
}

unsigned number(const fs::path& option, unsigned max) {
    const auto value = option.string();
    unsigned result = 0;
    const auto end = value.data() + value.size();
    const auto [ptr, code] = std::from_chars(value.data(), end, result);
    if (ptr != end || code != std::errc{} || result > max)
        throw std::runtime_error("E_R06_ARGUMENTS");
    return result;
}

template<class Char>
int run(int argc, Char** argv) {
    if (argc != 6) throw std::runtime_error("E_R06_ARGUMENTS");
    const auto model = fgm::Evaluator::from_package(read(argv[1], 4U * 1024 * 1024));
    const auto pixels = read(argv[2], r05::spriteWidth * r05::spriteHeight);
    const auto material = fs::path(argv[3]).string();
    const auto pLevel = static_cast<std::uint8_t>(number(argv[4], 255));
    const auto rightHalf = number(argv[5], 1) != 0;
    std::array<std::uint8_t, r05::spriteWidth * r05::spriteHeight> raster{};
    if (pixels.size() != raster.size()) throw std::runtime_error("E_R06_RASTER");
    for (std::size_t i = 0; i < pixels.size(); ++i)
        raster[i] = static_cast<std::uint8_t>(pixels[i]);

    const auto sampled = fgmr::sample_occupancy(model, material);
    const r02::Tile tile{};
    const auto count = r05::compare(r05::projectLoft(tile, sampled.rows),
                                    r05::spriteMask(tile, raster, pLevel, rightHalf));
    std::cout << sampled.mask << '\n' << count.common << ' ' << count.predictedOnly << ' '
              << count.observedOnly << '\n' << std::flush;
    return std::cout ? 0 : 2;
}
}

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
#else
int main(int argc, char** argv) {
#endif
    try {
        return run(argc, argv);
    } catch (const std::exception& error) {
        std::cerr << "R06: " << error.what() << '\n';
        return 2;
    }
}
