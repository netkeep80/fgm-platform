#include <fgm/evaluator.hpp>
#include <nlohmann/json.hpp>
#include "rvi-v02.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <compare>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {
using Json = nlohmann::json;
using Parameters = std::array<int, 3>;
using rvi::Vec;

constexpr int side = 32;
constexpr int budget = 192;
constexpr double scale = 0.125;
constexpr double edge = 1.5;
constexpr double depth = 0.25;
constexpr double bottom = -0.625;
constexpr Parameters truth{-4, 5, 4};
constexpr std::array<Parameters, 3> starts{{{-6, 3, 2}, {-2, 7, 6}, {-5, 6, 2}}};
struct Probe { Vec point; bool solid; };
constexpr std::array<Probe, 6> protectedPoints{{
    {{0, 0, -0.15}, false}, {{0, 0, 0.15}, false},
    {{-0.80, 0, 0}, true}, {{0.93, 0, 0}, true},
    {{0, 0.93, 0}, true}, {{0, -0.82, 0}, true},
}};

struct View { const char* name; Vec right, up, towardViewer; };
constexpr double diagonal = 0.7071067811865476;
constexpr View front{"front", {1,0,0}, {0,1,0}, {0,0,1}};
constexpr std::array<View, 4> heldOut{{
    {"rear", {-1,0,0}, {0,1,0}, {0,0,-1}},
    {"left_yaw", {diagonal,0,diagonal}, {0,1,0}, {-diagonal,0,diagonal}},
    {"right_yaw", {diagonal,0,-diagonal}, {0,1,0}, {diagonal,0,diagonal}},
    {"upper_pitch", {1,0,0}, {0,diagonal,-diagonal}, {0,diagonal,diagonal}},
}};

rvi::Scene panel(const Parameters& p) {
    rvi::Body body;
    body.kind = rvi::Kind::panel;
    body.id = "panel";
    body.material = "steel";
    body.lower = {-edge, -edge, -depth};
    body.upper = {edge, edge, depth};
    body.hole_lower = {p[0] * scale, bottom, -0.5};
    body.hole_upper = {p[1] * scale, p[2] * scale, 0.5};
    return {"r07_panel", {body}};
}

int violations(const rvi::Scene& scene) {
    int count = 0;
    for (const auto& probe : protectedPoints) {
        if ((!rvi::semantic_material(scene, probe.point).empty()) != probe.solid) ++count;
    }
    return count;
}

bool inRange(const Parameters& p) {
    return p[0] >= -7 && p[0] <= -2 && p[1] >= 2 && p[1] <= 8 && p[2] >= 2 && p[2] <= 8;
}

rvi::Ray ray(const View& view, int x, int y) {
    const double u = (x + 0.5 - side / 2.0) * scale;
    const double v = (side / 2.0 - y - 0.5) * scale;
    const Vec d = view.towardViewer;
    return {{u * view.right.x + v * view.up.x + 4 * d.x,
             u * view.right.y + v * view.up.y + 4 * d.y,
             u * view.right.z + v * view.up.z + 4 * d.z}, {-d.x,-d.y,-d.z}};
}

template<class Sample>
std::string raster(Sample sample) {
    std::string mask;
    mask.reserve(side * side);
    for (int y = 0; y < side; ++y)
        for (int x = 0; x < side; ++x)
            mask.push_back(sample(x, y) ? '1' : '0');
    return mask;
}

std::string render(const rvi::Scene& scene, const View& view) {
    return raster([&](int x, int y) { return rvi::render_recursive(scene, ray(view, x, y), 1).found; });
}

std::string frontOracle() {
    return raster([](int x, int y) {
        const auto sample = ray(front, x, y).origin;
        return std::abs(sample.x) < edge && std::abs(sample.y) < edge &&
               !(sample.x > truth[0] * scale && sample.x < truth[1] * scale &&
                 sample.y > bottom && sample.y < truth[2] * scale);
    });
}

struct Block { std::array<double,3> low, high; };

bool crosses(const rvi::Ray& line, const Block& block) {
    const std::array<double,3> o{line.origin.x,line.origin.y,line.origin.z};
    const std::array<double,3> d{line.direction.x,line.direction.y,line.direction.z};
    double entry = 0;
    double exit = std::numeric_limits<double>::infinity();
    for (std::size_t axis = 0; axis < d.size(); ++axis) {
        if (d[axis] == 0) {
            if (o[axis] <= block.low[axis] || o[axis] >= block.high[axis]) return false;
        } else {
            const double a = (block.low[axis] - o[axis]) / d[axis];
            const double b = (block.high[axis] - o[axis]) / d[axis];
            entry = std::max(entry, std::min(a, b));
            exit = std::min(exit, std::max(a, b));
        }
    }
    return entry < exit;
}

std::string heldOutOracle(const View& view) {
    const double left = truth[0] * scale, right = truth[1] * scale, top = truth[2] * scale;
    // Независимое разбиение панели на четыре сплошных прямоугольных блока.
    const std::array<Block,4> blocks{{
        {{-edge,-edge,-depth},{left,edge,depth}},
        {{right,-edge,-depth},{edge,edge,depth}},
        {{left,-edge,-depth},{right,bottom,depth}},
        {{left,top,-depth},{right,edge,depth}},
    }};
    return raster([&](int x, int y) {
        const auto line = ray(view,x,y);
        return std::ranges::any_of(blocks, [&](const Block& block) { return crosses(line, block); });
    });
}

using Pixel = std::array<int, 2>;
std::vector<Pixel> contour(const std::string& mask) {
    std::vector<Pixel> result;
    constexpr std::array<Pixel,4> neighbors{{{-1,0},{1,0},{0,-1},{0,1}}};
    const auto solid = [&](int x,int y) {
        return x >= 0 && y >= 0 && x < side && y < side &&
               mask[static_cast<std::size_t>(y * side + x)] == '1';
    };
    for (int y = 0; y < side; ++y)
        for (int x = 0; x < side; ++x)
            if (solid(x,y) && std::ranges::any_of(neighbors, [&](Pixel n) { return !solid(x+n[0],y+n[1]); }))
                result.push_back({x,y});
    return result;
}

int distance(const std::vector<Pixel>& from, const std::vector<Pixel>& to) {
    int sum = 0;
    for (const auto& p : from) {
        int nearest = 2 * side;
        for (const auto& q : to) nearest = std::min(nearest, std::abs(p[0]-q[0]) + std::abs(p[1]-q[1]));
        sum += nearest;
    }
    return sum;
}

struct Metrics {
    int maskXor, contourL1;
    auto operator<=>(const Metrics&) const = default;
};

Metrics measure(const std::string& value, const std::string& target) {
    const auto outline = contour(value), expected = contour(target);
    int differences = 0;
    for (std::size_t i = 0; i < value.size(); ++i)
        if (value[i] != target[i]) ++differences;
    return {differences, distance(outline, expected) + distance(expected, outline)};
}

Json metricJson(Metrics m) {
    return {{"mask_xor",m.maskXor},{"contour_l1",m.contourL1}};
}

struct Fit {
    Parameters result;
    Json trace;
};

Fit fit(const std::string& target, Parameters start) {
    const auto begin = std::chrono::steady_clock::now();
    int attempts = 1, renders = 1, rangeRejected = 0, protectedRejected = 0;
    const auto initial = panel(start);
    if (!inRange(start) || violations(initial) != 0) throw std::runtime_error("E_R07_START");
    Parameters current = start;
    const auto before = measure(render(initial, front), target);
    Metrics best = before;
    std::map<Parameters, Metrics> known{{start, before}};
    while (best.maskXor != 0 && attempts < budget) {
        auto next = current;
        auto nextLoss = best;
        for (std::size_t dim = 0; dim < current.size() && attempts < budget; ++dim) {
            for (int delta : {-1, 1}) {
                if (attempts == budget) break;
                ++attempts;
                auto proposal = current;
                proposal[dim] += delta;
                if (!inRange(proposal)) {
                    ++rangeRejected;
                    continue;
                }
                const auto candidate = panel(proposal);
                if (violations(candidate) != 0) {
                    ++protectedRejected;
                    continue;
                }
                auto existing = known.find(proposal);
                if (existing == known.end()) {
                    const auto loss = measure(render(candidate, front), target);
                    existing = known.emplace(proposal, loss).first;
                    ++renders;
                }
                const auto loss = existing->second;
                if (loss < nextLoss) {
                    next = proposal;
                    nextLoss = loss;
                }
            }
        }
        if (next == current) break;
        current = next;
        best = nextLoss;
    }
    const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - begin).count();
    return {current, {{"initial",start},{"final",current},{"before",metricJson(before)},
                      {"after",metricJson(best)},{"attempts",attempts},{"renders",renders},
                      {"rejected",rangeRejected+protectedRejected},{"rejected_range",rangeRejected},
                      {"rejected_protected",protectedRejected},{"duration_us",elapsed},
                      {"violations_final",violations(panel(current))}}};
}

Json experiment() {
    const auto reference = frontOracle();
    Json traces = Json::array();
    Parameters final{};
    for (const auto& start : starts) {
        auto result = fit(reference, start);
        if (traces.empty()) final = result.result;
        traces.push_back(std::move(result.trace));
    }
    const auto initial = panel(starts.front()), fitted = panel(final);
    Json views = Json::object();
    Json images = {{front.name, {reference,render(initial,front),render(fitted,front)}}};
    for (const auto& view : heldOut) {
        const auto target = heldOutOracle(view);
        const auto before = render(initial, view), after = render(fitted, view);
        views[view.name] = {{"before",metricJson(measure(before,target))},
                            {"after",metricJson(measure(after,target))}};
        images[view.name] = {target,before,after};
    }
    return {{"schema","fgm-regenerator/panel-fit-v1"},{"truth",truth},{"fit",final},
            {"attempt_budget",budget},{"starts",traces},{"held_out",views},{"images",images},
            {"training_view",front.name},{"unobserved_surface_status","hypothesis"}};
}

Parameters readParameters(const Json& input) {
    Parameters result{};
    if (!input.is_array() || input.size() != result.size())
        throw std::runtime_error("E_R07_PARAMETERS");
    for (std::size_t i = 0; i < result.size(); ++i) {
        const auto& value = input[i];
        if (!value.is_number_integer()) throw std::runtime_error("E_R07_PARAMETERS");
        const double numeric = value.get<double>();
        if (numeric < std::numeric_limits<int>::min() || numeric > std::numeric_limits<int>::max())
            throw std::runtime_error("E_R07_PARAMETERS");
        result[i] = value.get<int>();
    }
    return result;
}

void verify() {
    const auto input = Json::parse(std::cin);
    const auto parameters = readParameters(input.at("fit"));
    const auto scene = panel(parameters);
    if (!inRange(parameters) || violations(scene) != 0) throw std::runtime_error("E_R07_PROTECTED");
    const auto evaluator = fgm::Evaluator::from_package(input.at("package").get<std::string>());
    const auto check = [&](Vec point) {
        const auto expected = rvi::semantic_material(scene, point);
        const auto sampled = evaluator.sample_local({point.x,point.y,point.z});
        if (expected != sampled.material.value_or("") || (!expected.empty()) != (sampled.value < 0))
            throw std::runtime_error("E_R07_C05");
    };
    for (int z = 0; z < side; ++z)
        for (int y = 0; y < side; ++y)
            for (int x = 0; x < side; ++x)
                check({(x-15.5)*scale,(y-15.5)*scale,(z-15.5)*scale});
    for (const auto& probe : protectedPoints) check(probe.point);
}

} // namespace

int main(int argc, char** argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--verify") {
            verify();
        } else if (argc == 1) {
            std::cout << experiment().dump() << '\n' << std::flush;
            if (!std::cout) return 2;
        } else {
            throw std::runtime_error("E_R07_ARGUMENTS");
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "R07: " << error.what() << '\n';
        return 2;
    }
}
