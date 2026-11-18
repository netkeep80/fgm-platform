#include "scene.hpp"
#include <array>
#include <cmath>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>

int main(int argc, char** argv) {
  try {
    if (argc != 2) throw std::runtime_error("fixture argument required");
    std::ifstream input(argv[1]);
    if (!input) throw std::runtime_error("fixture unavailable");
    const std::string package{std::istreambuf_iterator<char>(input), {}};
    std::array<float, scene_size * scene_size> field{}, repeated{};
    sample_scene(package, field);
    sample_scene(package, repeated);
    if (field != repeated) throw std::runtime_error("nondeterministic scene");
    std::size_t inside = 0, outside = 0;
    for (int y = 0; y < scene_size; ++y) for (int x = 0; x < scene_size; ++x) {
      // Независимый аналитический oracle синтетической sphere fixture: r=1.06, z=0.25.
      const double px = (x + 0.5) * 3.2 / scene_size - 1.6;
      const double py = (y + 0.5) * 3.2 / scene_size - 1.6;
      const float expected = static_cast<float>(std::sqrt(px*px + py*py + 0.25*0.25) - 1.06);
      const float actual = field[static_cast<std::size_t>(y*scene_size+x)];
      if (!std::isfinite(actual) || std::abs(actual - expected) > 2e-7f)
        throw std::runtime_error("analytic scene mismatch");
      if (actual < 0) ++inside; else ++outside;
    }
    if (!inside || !outside) throw std::runtime_error("degenerate corpus");
    bool rejected = false;
    try { sample_scene("{}", field); } catch (const std::exception&) { rejected = true; }
    if (!rejected) throw std::runtime_error("invalid package accepted");
    std::cout << "RENDERER_SCENE_PASS samples=" << field.size()
              << " inside=" << inside << " outside=" << outside
              << " repeated=MATCH invalid_package=REJECTED\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n'; return 1;
  }
}
