#include "studio-run.hpp"

extern "C" const char* fgmr_studio_call(const char* input, std::size_t size, std::uint32_t* written) {
    static fgmr::studio::Runner runner;
    static std::string reply;
    if (!written || (!input && size)) return nullptr;
    reply = runner.call(input ? std::string_view(input,size) : std::string_view{});
    *written = static_cast<std::uint32_t>(reply.size());
    return reply.data();
}
