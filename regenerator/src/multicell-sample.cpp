#include "whole-sampling.hpp"
#include <nlohmann/json.hpp>

#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <vector>

namespace {
namespace fs=std::filesystem;
using Json=nlohmann::json;

void require(bool valid) { if (!valid) throw std::runtime_error("E_S2B2_INPUT"); }
std::string read(const fs::path& path, std::uintmax_t maximum) {
    std::error_code error;
    auto size=fs::file_size(path,error);
    require(!error && size>0 && size<=maximum);
    std::ifstream stream(path,std::ios::binary);
    require(bool(stream));
    std::string out(static_cast<std::size_t>(size),'\0');
    stream.read(out.data(),static_cast<std::streamsize>(size));
    require(stream && stream.peek()==std::char_traits<char>::eof());
    return out;
}
std::array<int,3> parse_local(const Json& v) {
    require(v.is_array() && v.size()==3);
    std::array<int,3> result{};
    for(std::size_t i=0;i<3;++i) {
        require(v[i].is_number_integer());
        auto x=v[i].get<std::int64_t>();
        require(x>=-16 && x<=16);
        result[i]=static_cast<int>(x);
    }
    return result;
}
template<class Char> int run(int argc, Char** argv) {
    require(argc==4);
    auto model=read(argv[1],4U*1024*1024);
    auto request=Json::parse(read(argv[2],1024U*1024));
    require(request.is_object() && request.contains("schema") &&
            request.at("schema")=="fgm-regenerator/whole-object-sampling-v1"
            && request.contains("cells") && request.at("cells").is_array());
    std::vector<std::array<int,3>> cells;
    const auto& entries=request.at("cells");
    require(entries.size()>=2 && entries.size()<=8);
    for(const auto& entry:entries) {
        require(entry.is_object() && entry.contains("local_xyz"));
        cells.push_back(parse_local(entry.at("local_xyz")));
    }
    std::cout << fgmr::sample_whole(model,fs::path(argv[3]).string(),cells) << '\n';
    return std::cout?0:2;
}
}
#ifdef _WIN32
int wmain(int argc,wchar_t** argv) {
#else
int main(int argc,char** argv) {
#endif
    try {return run(argc,argv);}
    catch(const std::exception&) {
        std::cerr<<"R06-S2B2: E_SAMPLING\n";
        return 2;
    }
}
