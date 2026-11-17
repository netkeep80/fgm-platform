#include "studio-cell.hpp"

#include "model-occupancy.hpp"
#include "projection.hpp"
#include "sha256.hpp"
#include "sprite-facts.hpp"

#include <algorithm>
#include <array>
#include <locale>
#include <sstream>

#include <nlohmann/json.hpp>

namespace fgmr::studio {
namespace {
using Json = nlohmann::json;
using Point = std::array<int,3>;
using Corner = std::array<Point,4>;
constexpr int side = static_cast<int>(r03::kSide);
constexpr int height = static_cast<int>(r03::kHeight);
constexpr std::array<std::string_view,4> parts{"floor","west_wall","north_wall","object"};
constexpr std::size_t max_boxes = 1024;

void require(bool ok, const char* code) {
    if (!ok) throw CellError{code};
}

bool occupied(const r03::Rows& rows, int x, int y, int z) {
    return x>=0 && x<side && y>=0 && y<side && z>=0 && z<height &&
           (rows[static_cast<std::size_t>(z*side+y)] & (1u << (side-1-x)))!=0;
}

struct Box { Point begin, end; };

std::vector<Box> boxes(r03::Rows remaining) {
    std::vector<Box> result;
    for (int z=0; z<height; ++z) for (int y=0; y<side; ++y) for (int x=0; x<side; ++x) {
        if (!occupied(remaining,x,y,z)) continue;
        int endX=x+1, endY=y+1, endZ=z+1;
        while (occupied(remaining,endX,y,z)) ++endX;
        const auto containsRow = [&](int row, int layer) {
            for (int column=x; column<endX; ++column)
                if (!occupied(remaining,column,row,layer)) return false;
            return true;
        };
        while (containsRow(endY,z)) ++endY;
        const auto containsPlane = [&](int layer) {
            for (int row=y; row<endY; ++row) if (!containsRow(row,layer)) return false;
            return true;
        };
        while (containsPlane(endZ)) ++endZ;
        for (int layer=z; layer<endZ; ++layer) for (int row=y; row<endY; ++row)
            for (int column=x; column<endX; ++column)
                remaining[static_cast<std::size_t>(layer*side+row)] &=
                    static_cast<std::uint16_t>(~(1u<<(side-1-column)));
        require(result.size()<max_boxes,"E_STUDIO_BOX_LIMIT");
        result.push_back({{x,y,z},{endX,endY,endZ}});
    }
    return result;
}

Json half(int value) {
    return value%2==0 ? Json(value/2) : Json(value/2.0);
}

Json rows_json(const r03::Rows& rows) {
    auto layers=Json::array();
    for (std::size_t z=0; z<r03::kHeight; ++z) {
        auto layer=Json::array();
        for (std::size_t y=0; y<r03::kSide; ++y) layer.push_back(rows[z*r03::kSide+y]);
        layers.push_back(std::move(layer));
    }
    return layers;
}

std::string package(const std::vector<Box>& bounds, const std::string& material,
                    const Json& observation) {
    auto nodes=Json::array();
    std::vector<std::string> level;
    if (bounds.empty()) {
        nodes.push_back({{"id","extent"},{"op","constant"},{"type","vec3"},{"value",{1,1,1}}});
        nodes.push_back({{"id","box"},{"op","box"},{"halfSize","extent"}});
        nodes.push_back({{"id","empty"},{"op","subtract"},{"left","box"},{"right","box"}});
        level.emplace_back("empty");
    }
    for (std::size_t i=0; i<bounds.size(); ++i) {
        const auto& [begin,end]=bounds[i];
        const auto suffix=std::to_string(i);
        const auto extent="extent_"+suffix, offset="offset_"+suffix, box="box_"+suffix, moved="move_"+suffix;
        Json size=Json::array(), center=Json::array();
        for (std::size_t axis=0; axis<3; ++axis) {
            size.push_back(half(end[axis]-begin[axis]));
            center.push_back(half(end[axis]+begin[axis]));
        }
        nodes.push_back({{"id",extent},{"op","constant"},{"type","vec3"},{"value",std::move(size)}});
        nodes.push_back({{"id",offset},{"op","constant"},{"type","vec3"},{"value",std::move(center)}});
        nodes.push_back({{"id",box},{"op","box"},{"halfSize",extent}});
        nodes.push_back({{"id",moved},{"op","translate"},{"field",box},{"offset",offset}});
        level.push_back(moved);
    }
    std::size_t union_index=0;
    while (level.size()>1) {
        std::vector<std::string> parents;
        for (std::size_t i=0; i+1<level.size(); i+=2) {
            const auto id="union_"+std::to_string(union_index++);
            nodes.push_back({{"id",id},{"op","union"},{"left",level[i]},{"right",level[i+1]}});
            parents.push_back(id);
        }
        if (level.size()%2) parents.push_back(level.back());
        level=std::move(parents);
    }
    const Json generation={{"algorithm","r06_loft_boxes"},{"version","1.0.0"},
        {"parameters",Json::object()},{"resources",{{"loft_observation",sha256(observation.dump())}}}};
    const auto seed=sha256(Json::array({"fgm:seed:1",{{"generation",generation},{"purpose","model"}}}).dump());
    const Json field={{"op","program"},{"parameters",Json::object()},
        {"program",{{"version","fgm-0"},{"nodes",std::move(nodes)},{"root",level.front()}}}};
    return Json{{"format","fgm-package/1"},{"interpreter","fgm-0/1"},{"generation",generation},
        {"model",{{"seed",seed},{"volumes",Json::object()},{"contributions",Json::array({
            {{"id","terrain"},{"material",material},{"priority",0},{"field",field}}})}}}}.dump();
}

std::string mesh(const r03::Rows& rows) {
    constexpr std::array<Point,6> neighbors{{{-1,0,0},{1,0,0},{0,-1,0},{0,1,0},{0,0,-1},{0,0,1}}};
    constexpr std::array<Corner,6> corners{{
        {{{0,0,0},{0,0,1},{0,1,1},{0,1,0}}}, {{{1,0,0},{1,1,0},{1,1,1},{1,0,1}}},
        {{{0,0,0},{1,0,0},{1,0,1},{0,0,1}}}, {{{0,1,0},{0,1,1},{1,1,1},{1,1,0}}},
        {{{0,0,0},{0,1,0},{1,1,0},{1,0,0}}}, {{{0,0,1},{1,0,1},{1,1,1},{0,1,1}}}}};
    std::map<Point,std::size_t> indices;
    std::ostringstream vertices, faces;
    vertices.imbue(std::locale::classic());
    faces.imbue(std::locale::classic());
    vertices<<"o terrain\n";
    for (int x=0; x<side; ++x) for (int y=0; y<side; ++y) for (int z=0; z<height; ++z) {
        if (!occupied(rows,x,y,z)) continue;
        for (std::size_t i=0; i<neighbors.size(); ++i) {
            const auto [dx,dy,dz]=neighbors[i];
            if (occupied(rows,x+dx,y+dy,z+dz)) continue;
            faces<<'f';
            for (const auto& [a,b,c]:corners[i]) {
                const Point vertex{x+a,y+b,z+c};
                const auto [index,inserted]=indices.try_emplace(vertex,indices.size()+1);
                if (inserted) vertices<<"v "<<vertex[0]<<' '<<vertex[1]<<' '<<vertex[2]<<'\n';
                faces<<' '<<index->second;
            }
            faces<<'\n';
        }
    }
    return vertices.str()+faces.str();
}

unsigned hex_digit(char c) {
    if (c>='0' && c<='9') return static_cast<unsigned>(c-'0');
    return static_cast<unsigned>(c-'a'+10); // R04 serializes lowercase hex.
}

} // namespace

CellResult reconstruct_cell(const CellSpec& spec, const Files& files) {
    const auto& map=files.at(spec.map);
    const auto& loft=files.at(spec.loft);
    require(map.size()<=64*1024,"E_STUDIO_LIMIT");
    std::vector<r02::DataSet> datasets;
    auto bindings=Json::array();
    for (const auto& item:spec.datasets) {
        const auto& bytes=files.at(item.file);
        datasets.push_back({item.id,bytes});
        bindings.push_back({{"id",item.id},{"sha256",sha256(bytes)}});
    }
    const auto facts=r02::decode(map,datasets);
    const auto profiles=r03::decodeLoft(loft);
    const auto tile=r03::build(facts,profiles,spec.tile[0],spec.tile[1],spec.tile[2]);
    const auto& source=tile.sources.at(spec.part);
    require(source.present,"E_STUDIO_PART");
    require(source.dataset==spec.sprite_dataset,"E_STUDIO_SPRITE_BINDING");
    const auto data=std::ranges::find_if(facts.datasets,[&](const auto& entry) { return entry.id==source.dataset; });
    require(data!=facts.datasets.end(),"E_STUDIO_SPRITE_BINDING");
    const auto& pck=files.at(spec.pck);
    const auto& tab=files.at(spec.tab);
    const auto& palette=files.at(spec.palette);
    const auto sprite_json=r04::spriteFacts(pck,tab,palette,data->bytes,spec.tab_bits,spec.palette_index,source.localIndex);
    const auto sprite=Json::parse(sprite_json);
    const auto frame=sprite.at("mcd_frame_slots").at(spec.slot);
    std::array<std::uint8_t,r05::spriteWidth*r05::spriteHeight> raster{};
    const auto& frames=sprite.at("frames");
    const auto selected=std::ranges::find_if(frames,[&](const Json& item) { return item.at("id")==frame; });
    require(selected!=frames.end(),"E_STUDIO_FRAME");
    const auto& hex=selected->at("indices_hex").get_ref<const std::string&>();
    require(hex.size()==2*raster.size(),"E_STUDIO_FRAME");
    for (std::size_t i=0; i<raster.size(); ++i)
        raster[i]=static_cast<std::uint8_t>(hex_digit(hex[2*i])*16+hex_digit(hex[2*i+1]));
    const auto p_level=data->bytes.at(source.localIndex*62+49);
    const bool right_half=spec.part==2 && tile.sources[1].present;
    const Json identity={{"dataset_label",source.dataset},{"local_index",source.localIndex},{"part",parts[spec.part]}};
    const auto& rows=tile.partRows[spec.part];
    const auto bounds=boxes(rows);
    auto model=package(bounds,spec.material,{{"source",identity},{"rows",rows_json(rows)},{"material",spec.material}});
    const auto evaluation=sample_occupancy(fgm::Evaluator::from_package(model),spec.material);
    require(evaluation.rows==rows,"E_STUDIO_COLLISION_DIVERGENCE");
    auto preview=mesh(evaluation.rows);
    // R05 is the only semantic source of observed/predicted pixel coordinates.
    // The browser may paint these coordinates; it must not reimplement R05.
    const auto predicted=r05::projectLoft(tile.tile,evaluation.rows);
    const auto observed=r05::spriteMask(tile.tile,raster,p_level,right_half);
    const auto counts=r05::compare(predicted,observed);
    const auto pixels=[](const r05::Mask& mask) {
        auto result=Json::array();
        for (const auto& pixel:mask) result.push_back(Json::array({pixel.x,pixel.y}));
        return result;
    };
    const r05::Point tile_point{spec.tile[0],spec.tile[1],spec.tile[2]};
    const auto tile_anchor=r05::tileAnchor(tile_point);
    const auto sprite_anchor=r05::spriteAnchor(tile_point,p_level);
    const auto visual=Json{
        {"schema","fgmr-studio-r05-observation/1"},
        {"coordinate_frame","r05-ufo-dimetric/1"},
        {"tile",spec.tile},
        {"tile_anchor",Json::array({tile_anchor.x,tile_anchor.y})},
        {"sprite",{
            {"width",r05::spriteWidth},{"height",r05::spriteHeight},
            {"indices_hex",hex},{"palette_rgb8",sprite.at("palette_rgb8")},
            {"anchor",Json::array({sprite_anchor.x,sprite_anchor.y})},
            {"p_level",p_level},{"right_half",right_half},
            {"transparent_index",0}
        }},
        {"predicted",pixels(predicted)},
        {"observed",pixels(observed)},
        {"silhouette",{{"common",counts.common},{"predicted_only",counts.predictedOnly},
                       {"observed_only",counts.observedOnly}}}
    }.dump();
    const auto model_hash=sha256(model);
    const auto report=Json{{"schema","fgmr-studio-cell/1"},{"source",identity},{"source_index",source.sourceIndex},
        {"dataset_order",std::move(bindings)},{"tile",spec.tile},{"material",spec.material},
        {"loft_ids",source.loftIds},{"frame_id",frame},{"slot",spec.slot},{"p_level",p_level},
        {"right_half",right_half},{"tab_bits",spec.tab_bits},{"palette_index",spec.palette_index},
        {"occupied",evaluation.occupied},{"boxes",bounds.size()},{"voxel_checks",voxel_count},
        {"silhouette",{{"common",counts.common},{"predicted_only",counts.predictedOnly},{"observed_only",counts.observedOnly}}},
        {"hidden_surface_confidence",nullptr},{"package_bytes_sha256",model_hash},
        {"input_sha256",{{"map",sha256(map)},{"loft",sha256(loft)},{"pck",sha256(pck)},{"tab",sha256(tab)},
                        {"palette",sha256(palette)},{"selected_mcd",sha256(data->bytes)}}}}.dump();
    const auto proof=Json{{"schema","fgmr-studio-c05-proof/1"},{"evaluation","C05"},{"model_sha256",model_hash},
        {"mesh_sha256",sha256(preview)},{"report_sha256",sha256(report)},
        {"r05_visual_sha256",sha256(visual)},{"voxels_checked",voxel_count},
        {"occupied",evaluation.occupied},{"coordinate_frame",{{"axes",{"x","y","z"}},{"unit","loft-voxel"},{"scale",1}}}}.dump();
    return {std::move(model),std::move(preview),report,proof,std::move(visual)};
}
} // namespace fgmr::studio
