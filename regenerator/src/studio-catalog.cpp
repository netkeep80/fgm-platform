#include "studio-catalog.hpp"

#include <algorithm>
#include <array>
#include <tuple>

#include <nlohmann/json.hpp>

namespace fgmr::studio {
namespace {
using Json = nlohmann::json;

struct Profile {
    std::string_view stem, name;
    std::vector<std::string> sets;
    int first = -1, last = -1; // -1 означает точное имя блока.
};

// Порядок и имена штатных блоков сверены с закреплёнными правилами OpenXcom.
const std::array profiles{
    Profile{"CULTA", "Ферма", {"BLANKS","CULTIVAT","BARN"}, 0, 18},
    Profile{"DESERT", "Пустыня", {"BLANKS","DESERT"}, 0, 11},
    Profile{"FOREST", "Лес", {"BLANKS","FOREST"}, 0, 11},
    Profile{"JUNGLE", "Джунгли", {"BLANKS","JUNGLE"}, 0, 11},
    Profile{"MARS", "Марс", {"BLANKS","MARS","U_WALL02"}, 0, 10},
    Profile{"MOUNT", "Горы", {"BLANKS","MOUNT"}, 0, 12},
    Profile{"POLAR", "Полярная местность", {"BLANKS","POLAR"}, 0, 13},
    Profile{"UBASE_", "База пришельцев", {"BLANKS","U_BASE","U_WALL02","U_PODS","BRAIN"}, 0, 15},
    Profile{"URBAN", "Город", {"BLANKS","ROADS","URBITS","URBAN","FRNITURE"}, 0, 9},
    Profile{"URBAN", "Город", {"BLANKS","ROADS","URBITS","URBAN","FRNITURE"}, 14, 18},
    Profile{"XBASE_", "База X-COM", {"BLANKS","XBASE1","XBASE2"}, 0, 20},
    Profile{"PLANE", "Скайрейнджер", {"BLANKS","PLANE"}},
    Profile{"LIGHTNIN", "Молния", {"BLANKS","LIGHTNIN"}},
    Profile{"AVENGER", "Мститель", {"BLANKS","AVENGER"}},
    Profile{"UFO1A", "Малый разведчик", {"BLANKS","UFO1"}},
    Profile{"UFO_110", "Средний разведчик", {"BLANKS","U_EXT02","U_WALL02","U_BITS"}},
    Profile{"UFO_120", "Большой разведчик", {"BLANKS","U_EXT02","U_WALL02","U_BITS"}},
    Profile{"UFO_130", "Сборщик", {"BLANKS","U_EXT02","U_WALL02","U_DISEC2","U_BITS"}},
    Profile{"UFO_140", "Похититель", {"BLANKS","U_EXT02","U_WALL02","U_OPER2","U_BITS"}},
    Profile{"UFO_150", "Корабль террора", {"BLANKS","U_EXT02","U_WALL02","U_PODS","U_BITS"}},
    Profile{"UFO_160", "Линкор", {"BLANKS","U_EXT02","U_WALL02","U_PODS","U_BITS"}},
    Profile{"UFO_170", "Корабль снабжения", {"BLANKS","U_EXT02","U_WALL02","U_DISEC2","U_BITS"}},
};
constexpr std::array<std::string_view,4> parts{"floor","west_wall","north_wall","object"};
constexpr std::array<std::string_view,4> part_names{"Пол","Западная стена","Северная стена","Объект"};
constexpr std::array<std::string_view,3> extensions{".MCD",".PCK",".TAB"};
constexpr std::string_view loft_path = "GEODATA/LOFTEMPS.DAT";
constexpr std::string_view palette_path = "GEODATA/PALETTES.DAT";

void require(bool ok, const char* code) {
    if (!ok) throw CatalogError{code};
}

const Profile* profile_for(std::string_view id) {
    for (const auto& profile : profiles) {
        if (profile.first < 0) {
            if (id == profile.stem) return &profile;
            continue;
        }
        if (!id.starts_with(profile.stem) || id.size() != profile.stem.size()+2) continue;
        const auto number = id.substr(profile.stem.size());
        if (!std::ranges::all_of(number, [](char c) {return c >= '0' && c <= '9';})) continue;
        const auto index = (number[0]-'0')*10 + (number[1]-'0');
        if (index >= profile.first && index <= profile.last) return &profile;
    }
    return nullptr;
}

using Paths = std::map<std::string,std::string,std::less<>>;

std::string normalize(const std::string& path) {
    require(!path.empty() && path.size()<=512 &&
            std::ranges::none_of(path, [](unsigned char c) {return c<32 || c=='\\' || c==':';}),
            "E_STUDIO_CATALOG_PATH");
    const std::string_view view(path);
    std::size_t start=0;
    for (;;) {
        const auto end=view.find('/',start);
        const auto component=view.substr(start,end==view.npos?view.npos:end-start);
        require(!component.empty() && component!="." && component!="..", "E_STUDIO_CATALOG_PATH");
        if (end==view.npos) break;
        start=end+1;
    }
    auto folded=path;
    for (auto& c:folded) if (c>='a' && c<='z') c=static_cast<char>(c-'a'+'A');
    return folded;
}

Json path_or_null(const Paths& paths, std::string_view key) {
    const auto it=paths.find(key);
    return it==paths.end() ? Json(nullptr) : Json(it->second);
}

std::string terrain_path(std::string_view dataset, std::string_view extension) {
    return "TERRAIN/"+std::string(dataset)+std::string(extension);
}

std::pair<std::string_view,std::string_view> describe(const r02::Bytes& bytes, std::size_t record,
                                                       std::size_t part) {
    const auto first=record*62;
    if (bytes[first+30]!=0) return {"ufo_door","Дверь НЛО"};
    if (bytes[first+35]!=0) return {"door","Дверь"};
    if (bytes[first+34]!=0) return {"gravlift","Гравилифт"};
    return {parts[part],part_names[part]};
}
} // namespace

Json catalog_directory(const Json& input) {
    require(input.is_array() && input.size()<=4096,"E_STUDIO_CATALOG_PATHS");
    std::map<std::string,Paths> roots;
    for (const auto& item:input) {
        require(item.is_string(),"E_STUDIO_CATALOG_PATH");
        const auto& path=item.get_ref<const std::string&>();
        const auto key=normalize(path);
        const auto slash=key.rfind('/');
        if (slash==key.npos) continue;
        const auto root=slash==0?key.npos:key.rfind('/',slash-1);
        const auto relative=key.substr(root==key.npos?0:root+1);
        if (!(relative==loft_path || relative==palette_path ||
              (relative.starts_with("MAPS/") && relative.ends_with(".MAP")) ||
              (relative.starts_with("TERRAIN/") && std::ranges::any_of(extensions,[&](auto ext) {
                  return relative.ends_with(ext);
              })))) continue;
        auto& paths=roots[root==key.npos?"":key.substr(0,root)];
        require(paths.emplace(relative,path).second,"E_STUDIO_CATALOG_DUPLICATE");
    }
    require(roots.size()==1,"E_STUDIO_CATALOG_ROOT");
    const auto& paths=roots.begin()->second;
    auto terrain=Json::object(), maps=Json::array();
    for (const auto& [key,path]:paths) {
        if (key.starts_with("TERRAIN/") && key.ends_with(".MCD")) {
            const auto id=key.substr(8,key.size()-12);
            terrain[id]={{"mcd",path},{"pck",path_or_null(paths,terrain_path(id,".PCK"))},
                         {"tab",path_or_null(paths,terrain_path(id,".TAB"))}};
        }
        if (!key.starts_with("MAPS/")) continue;
        const auto id=key.substr(5,key.size()-9);
        const auto* profile=profile_for(id);
        Json missing=Json::array();
        if (profile) {
            for (const auto geodata:{loft_path,palette_path})
                if (!paths.contains(geodata)) missing.push_back(geodata);
            for (const auto& dataset:profile->sets) for (const auto ext:extensions) {
                const auto expected=terrain_path(dataset,ext);
                if (!paths.contains(expected)) missing.push_back(expected);
            }
        }
        maps.push_back({{"id",id},{"path",path},{"name",profile?profile->name:"Неопознанный блок"},
            {"datasets",profile?Json(profile->sets):Json(nullptr)},{"missing",std::move(missing)}});
    }
    require(!maps.empty(),"E_STUDIO_CATALOG_MAPS");
    return {{"schema","fgmr-ufo-library/1"},{"maps",std::move(maps)},{"terrain",std::move(terrain)},
            {"loft",path_or_null(paths,loft_path)},{"palette",path_or_null(paths,palette_path)},
            {"paletteIndex",4},{"tabBits",16}};
}

Json catalog_map(std::string_view map_id, const Files& files) {
    const auto* profile=profile_for(map_id);
    require(profile!=nullptr,"E_STUDIO_CATALOG_PROFILE");
    require(files.size()==profile->sets.size()+1 && files.contains("map"),"E_STUDIO_CATALOG_INPUT");
    const auto& map=files.at("map");
    require(map.size()<=64*1024,"E_STUDIO_LIMIT");
    std::vector<r02::DataSet> sets;
    for (std::size_t i=0; i<profile->sets.size(); ++i) {
        const auto it=files.find("ds"+std::to_string(i));
        require(it!=files.end(),"E_STUDIO_CATALOG_INPUT");
        sets.push_back({profile->sets[i],it->second});
    }
    const auto facts=r02::decode(map,sets);
    // Один элемент на запись и тип части. Северная стена с западной стеной
    // в той же клетке получает отдельное наблюдение R05 с правой половиной.
    std::map<std::tuple<std::size_t,std::size_t,std::size_t,bool>,Json> elements;
    for (const auto& tile:facts.map.tiles) for(std::size_t p=0; p<parts.size(); ++p) {
        if (tile.parts[p]==0) continue;
        const auto ref=r02::resolveRecord(facts.datasets,tile.parts[p]);
        const bool right_half=p==2 && tile.parts[1]!=0;
        auto& item=elements[{parts.size()-1-p,ref.setIndex,ref.localIndex,right_half}];
        if (item.is_null()) {
            const auto& set=facts.datasets[ref.setIndex];
            const auto [kind,name]=describe(set.bytes,ref.localIndex,p);
            item={{"dataset",set.id},{"record",ref.localIndex},{"part",parts[p]},
                  {"tile",{tile.x,tile.y,tile.z}},{"kind",kind},{"name",name},
                  {"instances",0},{"rightHalf",right_half}};
        }
        item["instances"]=item["instances"].get<unsigned>()+1;
    }
    auto result=Json::array();
    for (auto& entry:elements) result.push_back(std::move(entry.second));
    return {{"schema","fgmr-ufo-map-elements/1"},{"map",map_id},
            {"dimensions",{facts.map.sizeX,facts.map.sizeY,facts.map.sizeZ}},
            {"elements",std::move(result)}};
}
} // namespace fgmr::studio
