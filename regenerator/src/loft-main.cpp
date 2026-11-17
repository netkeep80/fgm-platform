#include "loft-voxels.hpp"

#include <array>
#include <charconv>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

namespace {
namespace fs = std::filesystem;
constexpr std::uintmax_t kMaxMapBytes=1024ULL*1024;
constexpr std::uintmax_t kMaxMcdBytes=1024ULL*1024;
constexpr std::uintmax_t kMaxMcdTotal=4ULL*1024*1024;
constexpr std::uintmax_t kMaxLoftBytes=256ULL*32;

r02::Bytes readBytes(const fs::path& path, std::uintmax_t limit) {
    std::error_code ec;
    const auto type = fs::symlink_status(path,ec);
    if(ec || !fs::is_regular_file(type))
        throw std::runtime_error("E_R03_INPUT_TYPE");
    const auto size=fs::file_size(path,ec);
    if(ec || size==0 || size>limit)
        throw std::runtime_error("E_R03_INPUT_LIMIT");
    std::ifstream stream(path,std::ios::binary);
    if(!stream) throw std::runtime_error("E_R03_INPUT_OPEN");
    r02::Bytes result(static_cast<std::size_t>(size));
    stream.read(reinterpret_cast<char*>(result.data()),static_cast<std::streamsize>(size));
    if (!stream || static_cast<std::uintmax_t>(stream.gcount())!=size)
        throw std::runtime_error("E_R03_INPUT_READ");
    if (stream.peek() != std::char_traits<char>::eof())
        throw std::runtime_error("E_R03_INPUT_CHANGED");
    return result;
}
std::array<int,3> parsePoint(std::string_view text) {
    std::array<int,3> result{};
    for(std::size_t i=0;i<3;++i) {
        const auto comma = text.find(',');
        const auto field = text.substr(0,comma);
        if(field.empty()) throw std::invalid_argument("E_R03_COORDINATES");
        const auto [ptr,ec]=std::from_chars(field.data(),field.data()+field.size(),result[i]);
        if(ec!=std::errc{} || ptr!=field.data()+field.size())
            throw std::invalid_argument("E_R03_COORDINATES");
        if(i<2) {
            if(comma==std::string_view::npos)
                throw std::invalid_argument("E_R03_COORDINATES");
            text.remove_prefix(comma+1);
        } else if(comma!=std::string_view::npos) {
            throw std::invalid_argument("E_R03_COORDINATES");
        }
    }
    return result;
}
} // namespace

int main(int argc, char** argv) {
    try {
        fs::path mapPath,loftPath;
        std::vector<std::pair<std::string,fs::path>> sets;
        std::optional<std::array<int,3>> tile,probe;
        if(argc<9) throw std::invalid_argument("E_R03_ARGUMENTS");
        for(int i=1;i<argc;++i) {
            const std::string_view arg=argv[i];
            if(arg=="--map" && i+1<argc && mapPath.empty())
                mapPath=argv[++i];
            else if(arg=="--loft" && i+1<argc && loftPath.empty())
                loftPath=argv[++i];
            else if(arg=="--mcd" && i+1<argc) {
                const std::string decl=argv[++i];
                const auto equal=decl.find('=');
                if(equal==std::string::npos || equal==0 || equal==decl.size()-1)
                    throw std::invalid_argument("E_R03_ARGUMENTS");
                sets.emplace_back(decl.substr(0,equal),fs::path(decl.substr(equal+1)));
            } else if(arg=="--tile" && i+1<argc && !tile)
                tile=parsePoint(argv[++i]);
            else if(arg=="--voxel" && i+1<argc && !probe)
                probe=parsePoint(argv[++i]);
            else
                throw std::invalid_argument("E_R03_ARGUMENTS");
        }
        if(mapPath.empty() || loftPath.empty() || !tile ||
           sets.empty() || sets.size()>16)
            throw std::invalid_argument("E_R03_ARGUMENTS");
        // Hard aggregate bound; unlike a per-MCD-file bound this limits memory.
        std::uintmax_t total=0;
        std::vector<r02::DataSet> dataSets;
        dataSets.reserve(sets.size());
        for(const auto& [id,path]:sets) {
            auto bytes=readBytes(path,kMaxMcdBytes);
            if(bytes.size()>kMaxMcdTotal-total)
                throw std::runtime_error("E_R03_AGGREGATE_LIMIT");
            total += bytes.size();
            dataSets.push_back({id,std::move(bytes)});
        }
        const auto rawMap=readBytes(mapPath,kMaxMapBytes);
        const auto rawLoft=readBytes(loftPath,kMaxLoftBytes);
        const auto facts=r02::decode(rawMap,dataSets);
        const auto profiles=r03::decodeLoft(rawLoft);
        const auto masks=r03::build(facts,profiles,(*tile)[0],(*tile)[1],(*tile)[2]);
        std::cout << r03::toJson(masks,profiles.size(),probe);
        return 0;
    } catch (const std::invalid_argument& error) {
        std::cerr << "R03: " << error.what() << '\n';
        return 64;
    } catch (const std::exception& error) {
        std::cerr << "R03: " << error.what() << '\n';
        return 2;
    }
}
