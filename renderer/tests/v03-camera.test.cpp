#include "../src/v03-camera.hpp"

#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

using fgmv::v03::Camera;
using fgmv::v03::Pixel;
using fgmv::v03::Screen;
using fgmv::v03::Tile;
using fgmv::v03::Voxel;

namespace {
void require(bool value, const char* label) {
  if (!value) throw std::runtime_error(label);
}
template<class Function>
void reject(const char* code, Function function) {
  try { function(); }
  catch (const std::invalid_argument& e) {
    require(std::string(e.what())==code,"unexpected rejection code");
    return;
  }
  throw std::runtime_error("expected rejected invalid input");
}
Pixel independent_r05(Camera camera,Voxel p) {
  // Independent algebraic expansion of the four quarter-turn matrices.
  int u=0, numerator=0;
  switch (camera.quarter_turns) {
    case 0: u=p.x-p.y; numerator=40+p.x+p.y-2*p.z; break;
    case 1: u=15-p.y-p.x; numerator=55-p.y+p.x-2*p.z; break;
    case 2: u=p.y-p.x; numerator=70-p.x-p.y-2*p.z; break;
    case 3: u=p.y+p.x-15; numerator=55+p.y-p.x-2*p.z; break;
    default: throw std::runtime_error("unexpected view");
  }
  const auto tx=static_cast<std::int64_t>(camera.tile.x);
  const auto ty=static_cast<std::int64_t>(camera.tile.y);
  const auto tz=static_cast<std::int64_t>(camera.tile.z);
  return {16*(tx-ty)+camera.offset_x+16+u,
          8*(tx+ty)-24*tz+camera.offset_y+numerator/2};
}
bool close(double x,double y) {return std::abs(x-y)<1e-12;}
} // namespace

int main() {
  try {
    Camera base{{2,-1,3},0,7,-5};
    const Pixel anchor=fgmv::v03::tile_anchor(base);
    require(anchor.x==55&&anchor.y==-69,"R05 tile anchor or camera offset");

    const auto odd=fgmv::v03::raster_pixel(base,{0,1,23});
    require(odd.x==70&&odd.y==-71,"negative odd numerator must truncate toward zero");
    const auto continuous=fgmv::v03::project_continuous(base,0,1,23);
    require(close(continuous.x,70)&&close(continuous.y,-71.5),
            "continuous R05 calibration must not silently round to raster");

    // Fixed calibration control points: independent literal pixels, not only
    // a second implementation of the same rotation formula.
    const Pixel golden[]={{68,-53},{79,-50},{74,-45},{63,-47}};
    for(int turn=0;turn<4;++turn) {
      const auto observed=fgmv::v03::raster_pixel(
          fgmv::v03::quarter_turn(base,turn),Voxel{2,5,7});
      require(observed.x==golden[turn].x&&observed.y==golden[turn].y,
              "fixed independent 4-view R05 golden");
    }

    std::int64_t samples=0, inverses=0, orbits=0;
    for(int z=0;z<24;++z)for(int y=0;y<16;++y)for(int x=0;x<16;++x){
      const Voxel source{x,y,z};
      const auto first=fgmv::v03::raster_pixel(base,source);
      auto rotated=source;
      for(int turn=0;turn<4;++turn){
        const auto camera=fgmv::v03::quarter_turn(base,turn);
        const auto actual=fgmv::v03::raster_pixel(camera,source);
        const auto oracle=independent_r05(camera,source);
        require(actual.x==oracle.x&&actual.y==oracle.y,
                "raster pixel differs from independent R05 oracle");
        if(turn==0)require(actual.x==first.x&&actual.y==first.y,
                           "zero-turn viewport drift");
        const auto projected=fgmv::v03::project_continuous(camera,x,y,z);
        const auto inverse=fgmv::v03::unproject_on_plane(camera,projected,z);
        require(inverse.has_value()&&close(inverse->x,x)&&close(inverse->y,y),
                "continuous forward/inverse on the specified z plane");
        ++samples;++inverses;
        rotated=fgmv::v03::rotated_voxel(1,rotated);
      }
      require(rotated.x==source.x&&rotated.y==source.y&&rotated.z==source.z,
              "four exact quarter-turns must restore original local voxel");
      ++orbits;
    }

    Camera view=base;
    for(int t=0;t<4;++t)view=fgmv::v03::quarter_turn(view,1);
    require(view.quarter_turns==base.quarter_turns&&
            fgmv::v03::tile_anchor(view).x==anchor.x&&
            fgmv::v03::tile_anchor(view).y==anchor.y,
            "full camera orbit must restore exact camera");
    require(fgmv::v03::quarter_turn(base,-1).quarter_turns==3,
            "reverse quarter turn");
    require(fgmv::v03::quarter_turn(base,4000000000000LL).quarter_turns==0,
            "large signed step normalization");

    require(!fgmv::v03::unproject_on_plane(base,{-10000,-10000},0).has_value(),
            "out-of-tile inverse should not clamp to a false cell");

    reject("E_V03_ORIENTATION",[]{fgmv::v03::tile_anchor(Camera{{0,0,0},4,0,0});});
    reject("E_V03_ANCHOR",[]{fgmv::v03::tile_anchor(Camera{{1000001,0,0},0,0,0});});
    reject("E_V03_VOXEL",[]{fgmv::v03::raster_pixel(Camera{},Voxel{16,0,0});});
    reject("E_V03_VOXEL",[]{fgmv::v03::raster_pixel(Camera{},Voxel{0,0,24});});
    reject("E_V03_POINT",[]{fgmv::v03::project_continuous(Camera{},16,0,0);});
    reject("E_V03_NONFINITE",[]{fgmv::v03::project_continuous(
      Camera{},std::numeric_limits<double>::quiet_NaN(),0,0);});
    reject("E_V03_NONFINITE",[]{fgmv::v03::unproject_on_plane(
      Camera{},Screen{std::numeric_limits<double>::infinity(),0},0);});
    reject("E_V03_PLANE",[]{fgmv::v03::unproject_on_plane(Camera{},Screen{},24);});
    reject("E_V03_ANCHOR",[]{fgmv::v03::tile_anchor(
      Camera{{0,0,0},0,std::numeric_limits<std::int64_t>::min(),0});});
    reject("E_V03_ANCHOR",[]{fgmv::v03::tile_anchor(
      Camera{{0,0,0},0,0,std::numeric_limits<std::int64_t>::max()});});

    require(samples==24576&&inverses==24576&&orbits==6144,
            "test coverage is not the intended entire local tile");
    std::cout<<"{\"schema\":\"fgmv-v03-camera/1\",\"ok\":true,"
             <<"\"r05_samples\":"<<samples
             <<",\"inverse_checks\":"<<inverses
             <<",\"four_turn_orbits\":"<<orbits
             <<",\"negative_tests\":10}\n";
    return 0;
  } catch(const std::exception& e) {
    std::cerr<<"V03_CAMERA_FAIL: "<<e.what()<<"\n";
    return 2;
  }
}
