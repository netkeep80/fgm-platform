#include "map-facts.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {
namespace fs=std::filesystem;
constexpr std::uintmax_t kMaxBytes=16ULL*1024*1024;

r02::Bytes readBytes(const fs::path& path) {
    std::error_code ec;
    const auto info=fs::symlink_status(path,ec);
    if(ec || !fs::is_regular_file(info))
        throw std::runtime_error("E_R02_INPUT_TYPE");
    const auto size=fs::file_size(path,ec);
    if(ec || size==0 || size>kMaxBytes)
        throw std::runtime_error("E_R02_INPUT_LIMIT");
    std::ifstream input(path,std::ios::binary);
    if(!input) throw std::runtime_error("E_R02_INPUT_OPEN");
    r02::Bytes data(static_cast<std::size_t>(size));
    input.read(reinterpret_cast<char*>(data.data()),static_cast<std::streamsize>(size));
    if (!input || static_cast<std::uintmax_t>(input.gcount())!=size)
        throw std::runtime_error("E_R02_INPUT_READ");
    if(input.peek()!=std::char_traits<char>::eof())
        throw std::runtime_error("E_R02_INPUT_CHANGED");
    return data;
}
}
int main(int argc,char** argv) {
    try {
        if(argc<5) throw std::invalid_argument("E_R02_ARGUMENTS");
        std::string mapPath;
        std::vector<std::pair<std::string,std::string>> inputs;
        for (int i=1;i<argc;++i) {
            const std::string_view arg(argv[i]);
            if(arg=="--map" && i+1<argc && mapPath.empty())
                mapPath=argv[++i];
            else if(arg=="--mcd" && i+1<argc) {
                const std::string declaration=argv[++i];
                const auto delimiter=declaration.find('=');
                if(delimiter==std::string::npos || delimiter==0 ||
                   delimiter==declaration.size()-1)
                    throw std::invalid_argument("E_R02_ARGUMENTS");
                inputs.emplace_back(declaration.substr(0,delimiter),
                                    declaration.substr(delimiter+1));
            } else throw std::invalid_argument("E_R02_ARGUMENTS");
        }
        if(mapPath.empty() || inputs.empty())
            throw std::invalid_argument("E_R02_ARGUMENTS");
        std::vector<r02::DataSet> datasets;
        datasets.reserve(inputs.size());
        for (const auto& [id,path]:inputs)
            datasets.push_back({id,readBytes(path)});
        const auto map=readBytes(mapPath);
        const auto facts=r02::decode(map,datasets);
        std::cout << r02::toJson(facts); // No source path or input file I/O in JSON.
        return 0;
    } catch(const std::invalid_argument& error) {
        std::cerr << "R02: " << error.what() << '\n';
        return 64;
    } catch(const std::exception& error) {
        std::cerr << "R02: " << error.what() << '\n';
        return 2;
    }
}
