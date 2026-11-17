#include "studio-run.hpp"

#include <iostream>

int main() {
    fgmr::studio::Runner runner;
    constexpr auto eof = std::char_traits<char>::eof();
    bool truncated = false;
    for (std::string line; std::cin;) {
        const auto byte = std::cin.get();
        if (byte == '\n' || (byte == eof && !line.empty())) {
            if (!truncated && byte == '\n' && !line.empty() && line.back() == '\r') line.pop_back();
            std::cout << runner.call(line) << '\n';
            line.clear();
            truncated = false;
        } else if (byte != eof) {
            if (line.size() <= fgmr::studio::max_request) line.push_back(static_cast<char>(byte));
            else truncated = true;
        }
    }
    return std::cin.bad() || !std::cout ? 1 : 0;
}
