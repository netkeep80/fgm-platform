#include "whole-observation.hpp"
#include <iostream>
#include <stdexcept>
#include <string>
namespace {
constexpr std::size_t max_input_bytes = 5 * 1024 * 1024;
void require(bool ok,const char* code){if(!ok)throw std::runtime_error(code);}
std::string read_stdin() {
    std::string data;
    data.reserve(8192);
    char ch{};
    while (std::cin.get(ch)) {
        require(data.size() < max_input_bytes, "E_B0_INPUT_LIMIT");
        data.push_back(ch);
    }
    require(!data.empty() && !std::cin.bad(), "E_B0_INPUT");
    return data;
}
}
int main() {
    try {
        const auto request = nlohmann::json::parse(read_stdin());
        std::cout << fgmr::observe_whole(request).dump() << '\n';
        return std::cout ? 0 : 2;
    } catch (const std::exception& e) {
        const std::string reason = e.what();
        const bool known = reason.starts_with("E_B0_");
        std::cerr << "R07-S1B1B0: "
                  << (known ? reason : "E_B0_INVALID_MODEL_OR_INPUT") << '\n';
        return 2;
    }
}
