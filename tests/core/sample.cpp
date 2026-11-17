// Потребитель использует только публичный API Core, без его JSON-заголовков.
#include <fgm/evaluator.hpp>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <locale>
#include <string>
#include <vector>

int main(int argc, char** argv) {
  try {
    if (argc < 2 || argc > 3 || (argc == 3 && std::string(argv[2]) != "--reverse"))
      throw std::runtime_error("E_ARGUMENT");
    std::ifstream file(argv[1], std::ios::binary);
    if (!file) throw std::runtime_error("E_FIXTURE");
    const std::string bytes(std::istreambuf_iterator<char>{file}, {});
    const auto model = fgm::Evaluator::from_package(bytes);
    std::vector<fgm::Point> points;
    for (int z = 0; z < 24; ++z)
      for (int y = 0; y < 16; ++y)
        for (int x = 0; x < 16; ++x)
          points.push_back({double(x) + 0.5, double(y) + 0.5, double(z) + 0.5});
    for (const auto& point : {fgm::Point{0, 0, 0}, fgm::Point{1, 0, 0},
          fgm::Point{1, 1, 0}, fgm::Point{2, 1, 0}, fgm::Point{3, 0, 0}})
      points.push_back(point);
    std::cout.imbue(std::locale::classic());
    std::cout << std::setprecision(std::numeric_limits<double>::max_digits10);
    for (std::size_t n = 0; n < points.size(); ++n) {
      const auto index = argc == 3 ? points.size() - 1 - n : n;
      const auto sample = model.sample_local(points[index]);
      std::cout << index << '\t' << sample.value << '\t'
        << sample.material.value_or("-") << '\t' << sample.contributor.value_or("-") << '\n';
    }
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
