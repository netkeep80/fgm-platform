// Research-only public Core consumer. TSV protocol, one immutable package per process.
#include <fgm/evaluator.hpp>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <locale>
#include <stdexcept>
#include <string>

int main(int argc, char** argv) {
  try {
    if (argc != 7 && argc != 20) throw std::runtime_error("E_PROBE_ARGUMENT");
    std::ifstream f(argv[1], std::ios::binary);
    if (!f) throw std::runtime_error("E_PROBE_IO");
    const std::string bytes(std::istreambuf_iterator<char>{f}, {});
    const std::string mode(argv[3]), kind(argv[2]);
    auto num = [&](int i) {
      std::size_t n = 0;
      const std::string s(argv[i]);
      const double v = std::stod(s, &n);
      if (n != s.size()) throw std::runtime_error("E_PROBE_NUMBER");
      return v;
    };
    fgm::VolumeResolver resolver;
    if (kind != "none") {
      if (kind != "fixed" && kind != "reject" && kind != "throw" && kind != "inf")
        throw std::runtime_error("E_PROBE_RESOLVER");
      resolver = [kind](const fgm::VolumeDescriptor& desc) -> fgm::VolumeSampler {
        if (desc.format != "r0b_fixed" ||
            desc.sha256 != "046d40de544b17b35b5f123def77c65429e4516da6aca960bfd0ddd0c66a8e5e" ||
            kind == "reject") return {};
        return [kind](const fgm::Point& p) {
          if (kind == "throw") throw std::runtime_error("fixture failure");
          if (kind == "inf") return std::numeric_limits<double>::infinity();
          return p[0]/2 + p[1]/4 - 1;
        };
      };
    }
    const auto model = fgm::Evaluator::from_package(bytes, resolver);
    const fgm::Point point{num(4), num(5), num(6)};
    const auto sample = [&]() {
      if (mode == "local" && argc == 7) return model.sample_local(point);
      if (mode != "world" || argc != 20) throw std::runtime_error("E_PROBE_MODE");
      fgm::Placement p;
      for (int a=0; a<3; ++a) p.translation[a]=num(7+a);
      for (int a=0; a<3; ++a) for (int b=0; b<3; ++b)
        p.rotation[a][b]=num(10+3*a+b);
      p.scale=num(19);
      return model.sample_world(point,p);
    }();
    std::cout.imbue(std::locale::classic());
    std::cout << std::setprecision(std::numeric_limits<double>::max_digits10)
      << "OK\t" << sample.value << '\t' << sample.material.value_or("-")
      << '\t' << sample.contributor.value_or("-") << '\n';
    return 0;
  } catch (const fgm::Error& e) {
    std::cout << "ERROR\t" << e.what() << '\n';
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "PROBE_FAILURE\t" << e.what() << '\n';
    return 2;
  }
}
