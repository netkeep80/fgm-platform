#include "../src/v03-map-camera.hpp"

#include <array>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {
using namespace fgmv::v03;
const MapCamera base{{3, 2, 2}, 0, {512, 512}, {-256, -256}, 1};

void expect(bool value, std::string_view failure) {
  if (!value) throw std::runtime_error(std::string(failure));
}

bool close(double a, double b, double tolerance = 1e-9) {
  return std::abs(a - b) <= tolerance;
}

void screen_is(MapScreen actual, MapScreen expected, std::string_view label) {
  expect(close(actual.x, expected.x) && close(actual.y, expected.y), label);
}

void tile_is(Tile actual, Tile expected, std::string_view label) {
  expect(actual.x == expected.x && actual.y == expected.y && actual.z == expected.z, label);
}

void goldens() {
  const std::array<Screen, 4> origin{{{16,20}, {63,35.5}, {32,59}, {-15,43.5}}};
  const std::array<Screen, 4> exterior{{{0,28}, {16,20}, {32,28}, {16,36}}};
  const auto pivot = MapPoint{23.5, 15.5, 0};
  for (int turn = 0; turn < 4; ++turn) {
    const auto camera = map_quarter_turn(base, turn);
    screen_is(project_map(camera, {0,0,0}), origin[static_cast<std::size_t>(turn)], "origin golden");
    screen_is(project_map(camera, pivot), {24,39.5}, "fixed rectangular pivot");
    const MapCamera tile{{1,1,1}, turn, {512,512}, {-256,-256}, 1};
    screen_is(project_map(tile, {-0.5,15.5,-0.5}), exterior[static_cast<std::size_t>(turn)], "voxel edge golden");
  }
}

int all_voxels() {
  MapCamera camera = base;
  camera.pan = {};
  int samples = 0;
  for (int turn = 0; turn < 4; ++turn) {
    camera.quarter_turns = turn;
    for (int z = 0; z < 48; ++z) for (int y = 0; y < 32; ++y) for (int x = 0; x < 48; ++x) {
      const auto point = MapPoint{double(x), double(y), double(z)};
      const auto p = project_map(camera, point);
      if (turn == 0) {
        const Camera one{{x/16, y/16, z/24}, 0, 256, 256};
        screen_is(p, project_continuous(one, x%16, y%16, z%24), "R05 continuous parity");
      }
      const auto picked = pick_map_on_plane(camera, p, z);
      expect(picked && close(picked->world.x,x) && close(picked->world.y,y) &&
             picked->world.z == z, "project/inverse across tiles");
      tile_is(picked->tile, {x/16,y/16,z/24}, "selected tile");
      ++samples;
    }
  }
  return samples;
}

void edges_and_cursor() {
  MapCamera camera = base;
  camera.pan = {};
  camera.zoom = 2;
  for (int q = 0; q < 4; ++q) {
    const auto view = map_quarter_turn(camera, q);
    for (const auto point : {MapPoint{-0.5,-0.5,-0.5}, MapPoint{15.5,15.5,23.5},
                             MapPoint{15.25,15.75,23.25}, MapPoint{47.25,31.25,47.25}}) {
      const auto selected = pick_map_on_plane(view, project_map(view,point), point.z);
      expect(selected && close(selected->world.x,point.x) && close(selected->world.y,point.y),
             "fractional extent / boundary");
      tile_is(selected->tile, {int((point.x+0.5)/16),int((point.y+0.5)/16),int((point.z+0.5)/24)},
              "half-open ownership");
    }
    expect(!pick_map_on_plane(view,project_map(view,{47.5,10,10}),10),"outer X face unowned");
    expect(!pick_map_on_plane(view,project_map(view,{1,31.5,10}),10),"outer Y face unowned");
  }
  for (const auto edge : {MapPoint{-0.5,-0.5,0}, MapPoint{15.5,15.5,23.5}}) {
    const auto cursor = project_map(camera,edge);
    const auto original = pick_map_on_plane(camera,cursor,edge.z);
    expect(original.has_value(),"edge initially selectable");
    for (int turn = 0; turn < 4; ++turn) {
      for (double zoom : {0.2,0.9,1.1,1.3}) {
        const auto next = reframe_map_at(camera,cursor,edge.z,turn,zoom);
        expect(next.has_value(),"non-dyadic zoom at edge");
        const auto selected = pick_map_on_plane(*next,cursor,edge.z);
        expect(selected.has_value(),"edge remains selectable");
        tile_is(selected->tile,original->tile,"half-open edge remains owned by the same tile");
        const MapPoint pivot{23.5,15.5,0};
        screen_is(project_map(map_quarter_turn(*next,1),pivot),project_map(*next,pivot),
                  "centre remains fixed after anchored zoom");
      }
    }
  }
  const MapPoint target{31.25,18.75,30.5};
  const auto cursor = project_map(camera,target);
  for (int turn = 1; turn <= 4; ++turn) {
    const auto next = reframe_map_at(camera,cursor,target.z,1,turn == 4 ? 2.0 : 1.5);
    expect(next.has_value(), "cursor reframe");
    camera = *next;
    screen_is(project_map(camera,target),cursor,"cursor remains over world point");
    const auto selected = pick_map_on_plane(camera,cursor,target.z);
    expect(selected.has_value(),"cursor remains selectable");
    tile_is(selected->tile,{1,1,1},"selection remains fixed");
  }
  expect(camera.quarter_turns == 0 && camera.zoom == 2, "full cursor orbit");
  screen_is(camera.pan,{}, "cursor orbit has no translation drift");
  expect(map_quarter_turn(camera,std::numeric_limits<std::int64_t>::min()).quarter_turns==0,
         "extreme step normalization");
  expect(!pick_map_on_plane(camera,{-0.125,cursor.y},target.z),"left viewport edge");
  expect(!pick_map_on_plane(camera,{512,cursor.y},target.z),"right viewport edge");
  expect(!reframe_map_at(camera,{0,0},target.z,1,1),"background cannot be anchored");
}

int fractional_seam_ownership() {
  auto original = base;
  original.pan = {};
  int checks = 0;
  struct Example { MapPoint point; std::optional<Tile> tile; };
  const std::array<Example,7> cases{{
      {{-0.5,-0.5,0},Tile{0,0,0}},
      {{15.5,15.5,23.5},Tile{1,1,1}},
      {{31.5,15.5,7},Tile{2,1,0}},
      {{15.5-1e-6,15.5+1e-6,7},Tile{0,1,0}},
      {{15.5+1e-6,15.5-1e-6,7},Tile{1,0,0}},
      {{47.5,10,5},std::nullopt},
      {{10,31.5,5},std::nullopt},
  }};
  for (int q = 0; q < 4; ++q) {
    for (double zoom : {0.2,0.9,1.1,1.3,3.14159}) {
      auto turned = map_quarter_turn(original,q);
      auto ordinary = turned;
      ordinary.zoom = zoom;
      const MapPoint reference_point{7.125,6.25,10.5};
      const auto ref = project_map(turned,reference_point);
      const auto anchored = reframe_map_at(turned,ref,reference_point.z,0,zoom);
      expect(anchored.has_value(),"fractional reference");
      for (const auto& view : {ordinary,*anchored}) {
        for (const auto& item : cases) {
          const auto pixel = project_map(view,item.point);
          const auto result = pick_map_on_plane(view,pixel,item.point.z);
          expect(result.has_value() == item.tile.has_value(),"fractional outer ownership");
          if (result) tile_is(result->tile,*item.tile,"fractional internal ownership");
          ++checks;
        }
      }
    }
  }

  for (const MapPoint point : {MapPoint{-0.5,-0.5,0},MapPoint{15.5,15.5,23.5}}) {
    const auto cursor = project_map(original,point);
    const auto initial = pick_map_on_plane(original,cursor,point.z);
    expect(initial.has_value(),"boundary pick before turn orbit");
    const auto anchored = reframe_map_at(original,cursor,point.z,0,0.2);
    expect(anchored.has_value(),"zoom before turn orbit");
    auto camera = *anchored;
    for (int turn = 0; turn < 4; ++turn) camera = map_quarter_turn(camera,1);
    screen_is(project_map(camera,point),cursor,"fractional turn orbit screen");
    const auto result = pick_map_on_plane(camera,cursor,point.z);
    expect(result.has_value(),"fractional turn orbit ownership");
    tile_is(result->tile,initial->tile,"same tile after fractional turn orbit");
    ++checks;
  }

  auto tiny = original;
  tiny.zoom = std::numeric_limits<double>::denorm_min();
  const MapPoint point{23.5,15.5,0};
  expect(!pick_map_on_plane(tiny,project_map(tiny,point),0),"under-resolved viewport cannot give an unanchored tile");
  ++checks;

  for (const Screen anchor : {Screen{0,0},Screen{1,1}}) {
    const MapCamera precise{{3,2,2},2,{512,512},{},1,MapAnchor{{15.5,15,0},anchor}};
    const MapPoint left{std::nextafter(15.5,0),15,0};
    const auto left_pixel = project_map(precise,left);
    expect(left_pixel.x > anchor.x && left_pixel.y > anchor.y,"predecessor has distinct projected coordinates");
    const auto selected = pick_map_on_plane(precise,left_pixel,0);
    expect(selected.has_value(),"distinguishable predecessor remains selectable");
    tile_is(selected->tile,{0,0,0},"distinguishable predecessor remains in the previous tile");
    ++checks;
  }
  return checks;
}

int precision_at_cell_faces() {
  const MapCamera camera{{3,2,2},0,{512,512},{-256,0},0.2};
  const MapPoint before{15.5-1e-13,15,10.5};
  const auto cursor = project_map(camera,before);
  expect(cursor.x != project_map(camera,{15.5,before.y,before.z}).x,
         "P2-01 predecessor has a distinct horizontal projection");
  const auto picked = pick_map_on_plane(camera,cursor,before.z);
  expect(picked && picked->tile.x == 0,"P2-01 distinguishable predecessor belongs to tile 0");

  int checks = 1;
  auto projection_differs = [](MapScreen a, MapScreen b) {
    return a.x != b.x || a.y != b.y ||
           a.remainder.x != b.remainder.x || a.remainder.y != b.remainder.y;
  };
  for (int q = 0; q < 4; ++q) {
    for (double zoom : {0.2,0.9,1.1,1.3}) {
      MapCamera ordinary{{3,2,2},q,{512,512},{},zoom};
      const auto anchored = reframe_map_at(ordinary,project_map(ordinary,{7.125,6.25,10.5}),10.5,0,zoom);
      expect(anchored.has_value(),"fractional zoom anchor for precision tests");
      for (const auto& view : {ordinary,*anchored}) {
        for (double MapPoint::*axis : {&MapPoint::x,&MapPoint::y}) {
          const int Tile::*owner_index = axis == &MapPoint::x ? &Tile::x : &Tile::y;
          const double exterior = axis == &MapPoint::x ? 47.5 : 31.5;
          for (double boundary : {-0.5,15.5,exterior}) {
            MapPoint face{15,15,10.5};
            face.*axis = boundary;
            const auto face_pixel = project_map(view,face);
            const auto face_hit = pick_map_on_plane(view,face_pixel,face.z);
            expect(face_hit.has_value() == (boundary != exterior),"half-open ownership on a precise face");
            if (face_hit) {
              expect(face_hit->tile.*owner_index == (boundary == 15.5 ? 1 : 0),
                     "exact face belongs to the larger tile");
            }
            ++checks;
            for (double toward : {-1.0,64.0}) {
              auto adjacent = face;
              adjacent.*axis = std::nextafter(boundary,toward);
              if (adjacent.*axis < -0.5 || adjacent.*axis > exterior) continue;
              const auto pixel = project_map(view,adjacent);
              expect(projection_differs(pixel,face_pixel),"adjacent world point has distinct precise projection");
              const auto hit = pick_map_on_plane(view,pixel,adjacent.z);
              const int expected = int((static_cast<long double>(adjacent.*axis)+0.5L)/16);
              expect(hit && hit->tile.*owner_index == expected,"preserve the face side of an adjacent world point");
              ++checks;
            }
          }
        }
      }
    }
  }

  const MapCamera centered{{3,2,2},0,{512,512},{},0.2};
  const MapPoint face{15.5,15,10.5};
  const MapPoint neighbor{std::nextafter(face.x,0),face.y,face.z};
  const auto image = project_map(centered,face);
  const auto neighbor_image = project_map(centered,neighbor);
  expect(image.x == neighbor_image.x && image.y == neighbor_image.y,
         "nearest predecessor and seam share the display pair");
  expect(projection_differs(image,neighbor_image),"compensated coordinates keep the missing screen information");
  const auto chosen = pick_map_on_plane(centered,neighbor_image,neighbor.z);
  expect(chosen && chosen->tile.x == 0,"select the predecessor even when display coordinates coincide");
  ++checks;

  const Screen raw_cursor = project_map(base,face).rounded();
  const auto raw_hit = pick_map_on_plane(base,raw_cursor,face.z);
  expect(raw_hit && raw_hit->tile.x == 1,"ordinary screen cursor remains supported at an exact seam");
  ++checks;

  for (double zoom : {1e-15,1e-28,1e-30}) {
    const MapCamera tiny{{3,2,2},0,{512,512},{},zoom};
    const auto pixel = project_map(tiny,before);
    expect(projection_differs(pixel,project_map(tiny,face)),"tiny zoom retains the offset in the remainder");
    const auto hit = pick_map_on_plane(tiny,pixel,before.z);
    expect(hit && hit->tile.x == 0,"large display origin does not limit tiny-zoom precision");
    ++checks;
  }

  const MapPoint y_face{15,15.5,10.5};
  const MapPoint previous_y{15,std::nextafter(y_face.y,0),y_face.z};
  const MapCamera tiny{{3,2,2},0,{512,512},{},1e-15};
  const auto previous_pixel = project_map(tiny,previous_y);
  expect(projection_differs(previous_pixel,project_map(tiny,y_face)),
         "nearest Y predecessor is distinguishable in the screen remainder");
  const auto tiny_hit = pick_map_on_plane(tiny,previous_pixel,previous_y.z);
  expect(tiny_hit && tiny_hit->tile.y == 0,"resolvable nearest Y predecessor remains in tile 0");
  ++checks;

  const MapCamera ambiguous{{3,2,2},0,{512,512},{},1e-26};
  const auto shared_pixel = project_map(ambiguous,{std::nextafter(y_face.x,16),y_face.y,y_face.z});
  expect(!projection_differs(shared_pixel,project_map(ambiguous,previous_y)),
         "opposite owners can share the entire compensated projection at tiny zoom");
  expect(!pick_map_on_plane(ambiguous,shared_pixel,y_face.z),
         "unresolved ownership yields no selection");
  ++checks;
  return checks;
}

template<class Run>
void rejects(Run run) {
  try {
    run();
  } catch (const std::invalid_argument&) {
    return;
  }
  throw std::runtime_error("expected invalid_argument");
}

void invalid_inputs() {
  auto camera = base;
  camera.size.width = 0;
  rejects([&] { (void)project_map(camera,{}); });
  camera = base;
  camera.viewport.height = 0;
  rejects([&] { (void)project_map(camera,{}); });
  camera = base;
  camera.quarter_turns = 4;
  rejects([&] { (void)map_quarter_turn(camera,0); });
  camera = base;
  camera.zoom = 0;
  rejects([&] { (void)project_map(camera,{}); });
  camera = base;
  camera.pan.x = std::numeric_limits<double>::infinity();
  rejects([&] { (void)project_map(camera,{}); });
  camera = base;
  camera.anchor = MapAnchor{{48,0,0},{0,0}};
  rejects([&] { (void)project_map(camera,{}); });
  rejects([&] { (void)project_map(base,{48,0,0}); });
  rejects([&] { (void)pick_map_on_plane(base,{16,20},47.5); });
  rejects([&] { (void)pick_map_on_plane(base,{16,std::numeric_limits<double>::quiet_NaN()},0); });
  rejects([&] { (void)reframe_map_at(base,{16,20},0,0,-1); });
}
} // namespace

int main() {
  goldens();
  const int samples = all_voxels();
  edges_and_cursor();
  invalid_inputs();
  const int seams = fractional_seam_ownership();
  const int precision = precision_at_cell_faces();
  std::cout << "{\"schema\":\"fgmv-v03-map-camera/1\",\"ok\":true,\"inverse_samples\":"
            << samples << ",\"r05_samples\":" << samples/4
            << ",\"orientations\":4,\"edge_reframes\":32,\"negative_tests\":10,\"fractional_seams\":" << seams << ","
            << "\"precision_samples\":" << precision << ","
            << "\"origin_goldens\":[[16,20],[63,35.5],[32,59],[-15,43.5]]}\n";
}
