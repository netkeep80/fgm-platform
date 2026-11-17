#include "whole-build.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace {
namespace fs = std::filesystem;

std::string read_source(const fs::path& path) {
    const auto size = fs::file_size(path);
    if (size == 0 || size > fgmr::whole_build_source_limit)
        throw std::runtime_error("E_S43_BUILD_LIMIT");
    std::ifstream input(path, std::ios::binary);
    std::string bytes(static_cast<std::size_t>(size), '\0');
    if (!input.read(bytes.data(), static_cast<std::streamsize>(size))
        || input.peek() != std::char_traits<char>::eof() || input.bad())
        throw std::runtime_error("E_S43_BUILD_FILE");
    return bytes;
}

void write_result(const fs::path& out, const fgmr::WholeBuildResult& result) {
    if (!fs::create_directory(out)) throw std::runtime_error("E_S43_BUILD_OUTPUT");
    const std::pair<const char*, const std::string&> files[]{
        {"model.fgm.json",result.package},{"slices.json",result.slices},{"preview.obj",result.preview},
        {"report.json",result.report},{"input-proof.json",result.input_proof}};
    try {
        for (const auto& [name, bytes] : files) {
            std::ofstream stream(out / name, std::ios::binary);
            stream.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
            stream.close();
            if (!stream) throw std::runtime_error("E_S43_BUILD_OUTPUT");
        }
    } catch (...) {
        std::error_code ignored;
        for (const auto& file : files) fs::remove(out / file.first, ignored);
        fs::remove(out, ignored);
        throw;
    }
}

template<class Char>
int run(int argc, Char** argv) {
    if (argc < 9 || argc > 21 || argc % 2 == 0)
        throw std::runtime_error("E_S43_BUILD_ARGUMENTS");
    const auto receipt = read_source(argv[1]);
    const auto receipt_sha = fs::path(argv[2]).string();
    const auto material = fs::path(argv[3]).string();
    const fs::path out = argv[4];
    std::vector<std::pair<std::string,std::string>> data;
    for (int i = 5; i < argc; i += 2)
        data.emplace_back(read_source(argv[i]), fs::path(argv[i+1]).string());
    std::vector<fgmr::WholeBuildSource> sources;
    for (const auto& [bytes, sha] : data) sources.push_back({bytes, sha});
    write_result(out, fgmr::build_whole_object({receipt, receipt_sha}, sources, material));
    return 0;
}
}

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
#else
int main(int argc, char** argv) {
#endif
    try {
        return run(argc, argv);
    } catch (const fs::filesystem_error&) {
        std::cerr << "R06-ABI-S2A: E_S43_BUILD_FILE\n";
    } catch (const std::exception& error) {
        std::cerr << "R06-ABI-S2A: " << error.what() << '\n';
    }
    return 2;
}
