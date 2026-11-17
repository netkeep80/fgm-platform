#include "sprite-facts.hpp"

#include <charconv>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string_view>
#include <system_error>
#include <vector>

namespace {
namespace fs = std::filesystem;
using Options = std::map<fs::path, fs::path>;

template<class Char>
Options parseOptions(int argc, Char** argv) {
    if (argc != 15) throw std::invalid_argument("E_R04_ARGUMENTS");
    Options result;
    for (int i = 1; i < argc; i += 2) {
        if (!result.emplace(argv[i], argv[i + 1]).second)
            throw std::invalid_argument("E_R04_ARGUMENTS");
    }
    for (const auto key : {"--pck", "--tab", "--palette", "--mcd", "--tab-bits",
                           "--palette-index", "--record"}) {
        if (!result.contains(key) || result.at(key).empty())
            throw std::invalid_argument("E_R04_ARGUMENTS");
    }
    return result;
}

std::size_t natural(const fs::path& option) {
    const auto text = option.u8string();
    const std::string_view bytes(reinterpret_cast<const char*>(text.data()), text.size());
    std::size_t value = 0;
    const auto end = bytes.data() + bytes.size();
    const auto [position, error] = std::from_chars(bytes.data(), end, value);
    if (error != std::errc{} || position != end)
        throw std::invalid_argument("E_R04_ARGUMENTS");
    return value;
}

std::vector<std::uint8_t> readBytes(const fs::path& path, std::uintmax_t limit) {
    std::error_code error;
    if (!fs::is_regular_file(fs::symlink_status(path, error)) || error)
        throw std::runtime_error("E_R04_INPUT_TYPE");
    const auto size = fs::file_size(path, error);
    if (error || size > limit) throw std::runtime_error("E_R04_INPUT_LIMIT");
    std::ifstream stream(path, std::ios::binary);
    if (!stream) throw std::runtime_error("E_R04_INPUT_OPEN");
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
    if (!bytes.empty() && !stream.read(reinterpret_cast<char*>(bytes.data()),
                                      static_cast<std::streamsize>(bytes.size())))
        throw std::runtime_error("E_R04_INPUT_READ");
    if (stream.peek() != std::char_traits<char>::eof() || stream.bad())
        throw std::runtime_error("E_R04_INPUT_READ");
    return bytes;
}
} // namespace

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
#else
int main(int argc, char** argv) {
#endif
    try {
        const auto options = parseOptions(argc, argv);
        const auto bits = natural(options.at("--tab-bits"));
        if (bits != 16 && bits != 32) throw std::invalid_argument("E_R04_ARGUMENTS");
        const auto index = natural(options.at("--palette-index"));
        const auto record = natural(options.at("--record"));
        const auto pck = readBytes(options.at("--pck"), 4U * 1024 * 1024);
        const auto tab = readBytes(options.at("--tab"), 64U * 1024);
        const auto palette = readBytes(options.at("--palette"), 64U * 1024);
        const auto mcd = readBytes(options.at("--mcd"), 1024U * 1024);
        std::cout << r04::spriteFacts(pck, tab, palette, mcd, static_cast<unsigned>(bits), index, record);
        return 0;
    } catch (const std::invalid_argument& error) {
        std::cerr << "R04: " << error.what() << '\n';
        return 64;
    } catch (const std::exception& error) {
        std::cerr << "R04: " << error.what() << '\n';
        return 2;
    }
}
