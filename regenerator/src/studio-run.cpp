#include "studio-run.hpp"
#include "studio-catalog.hpp"
#include "sha256.hpp"
#include "whole-sampling.hpp"

#include <algorithm>
#include <array>
#include <limits>
#include <map>
#include <set>
#include <utility>

#include <nlohmann/json.hpp>

namespace fgmr::studio {
namespace {
using Json = nlohmann::json;
struct ProtocolError { const char* code; };

void require(bool ok, const char* code) {
    if (!ok) throw ProtocolError{code};
}

bool fields(const Json& value, std::initializer_list<std::string_view> keys) {
    if (!value.is_object() || value.size() != keys.size()) return false;
    for (auto key : keys) if (!value.contains(key)) return false;
    return true;
}

bool alnum(char c) {
    return (c>='a' && c<='z') || (c>='A' && c<='Z') || (c>='0' && c<='9');
}

std::string identifier(const Json& value) {
    require(value.is_string(),"E_STUDIO_BINDING");
    const auto& id=value.get_ref<const std::string&>();
    require(!id.empty() && id.size()<=48 &&
            std::ranges::all_of(id,[](char c) {return alnum(c) || c=='_' || c=='-';}),"E_STUDIO_BINDING");
    return id;
}

std::size_t bounded(const Json& value, std::size_t limit, const char* error) {
    require(value.is_number_unsigned() && value.get<std::uint64_t>()<=limit,error);
    return value.get<std::size_t>();
}

constexpr std::size_t build_source_limit = 64*1024;
constexpr std::size_t build_input_limit = 256*1024;
constexpr std::size_t build_output_limit = 1024*1024;
constexpr std::size_t build_chunk_size = 32*1024;
constexpr WholeBuildLimits build_limits{128,768*1024};
constexpr std::array build_artifacts{
    std::pair{"model.fgm.json",&WholeBuildResult::package},
    std::pair{"slices.json",&WholeBuildResult::slices},
    std::pair{"preview.obj",&WholeBuildResult::preview},
    std::pair{"report.json",&WholeBuildResult::report},
    std::pair{"input-proof.json",&WholeBuildResult::input_proof},
};

BuildSpec build_spec(const Json& input, const Json& budget, const Files& staged) {
    require(fields(input,{"receipt","lofts"}),"E_STUDIO_BINDING");
    const auto& lofts=input["lofts"];
    require(lofts.is_array() && lofts.size()>=whole_build_min_cells &&
            lofts.size()<=whole_build_max_cells,"E_STUDIO_LIMIT");
    require(budget.is_number_unsigned() && budget==voxel_count*lofts.size(),"E_STUDIO_BUDGET");
    std::size_t total=0;
    std::set<std::string> used;
    const auto binding=[&](const Json& alias) {
        require(fields(alias,{"file","sha256"}) && alias["sha256"].is_string(),"E_STUDIO_BINDING");
        auto file=identifier(alias["file"]);
        const auto& sha=alias["sha256"].get_ref<const std::string&>();
        require(sha.size()==64 && std::ranges::all_of(sha,[](char c) {
            return (c>='0'&&c<='9')||(c>='a'&&c<='f');
        }),"E_STUDIO_BINDING");
        const auto entry=staged.find(file);
        require(entry!=staged.end() && used.insert(file).second,"E_STUDIO_BINDING");
        const auto size=entry->second.size();
        require(size<=build_source_limit && size<=build_input_limit-total,"E_STUDIO_LIMIT");
        total+=size;
        return BuildBinding{std::move(file),sha};
    };
    BuildSpec spec{binding(input["receipt"]),{}};
    for (const auto& loft : lofts) spec.lofts.push_back(binding(loft));
    require(used.size()==staged.size(),"E_STUDIO_BINDING");
    return spec;
}

WholeBuildResult build_from_files(const BuildSpec& spec, const Files& files, std::string_view material) {
    const auto source=[&](const BuildBinding& ref) {
        const auto& bytes=files.at(ref.file);
        return WholeBuildSource{{reinterpret_cast<const char*>(bytes.data()),bytes.size()},ref.sha256};
    };
    std::vector<WholeBuildSource> lofts;
    for (const auto& item : spec.lofts) lofts.push_back(source(item));
    auto result=build_whole_object(source(spec.receipt),lofts,material,build_limits);
    std::size_t total=0;
    for (const auto& item : build_artifacts) total+=(result.*item.second).size();
    require(total<=build_output_limit,"E_STUDIO_LIMIT");
    return result;
}

unsigned digit(char c) {
    if (c>='0' && c<='9') return static_cast<unsigned>(c-'0');
    if (c>='a' && c<='f') return static_cast<unsigned>(c-'a'+10);
    throw ProtocolError{"E_STUDIO_HEX"};
}

void append_file(const Json& request, Files& staged, std::size_t& bytes) {
    require(fields(request,{"v","action","file","offset","hex"}) && request["hex"].is_string(),
            "E_STUDIO_REQUEST");
    constexpr std::size_t limit=4*1024*1024;
    const auto id=identifier(request["file"]);
    const auto offset=bounded(request["offset"],limit,"E_STUDIO_OFFSET");
    const auto it=staged.find(id);
    require(offset==(it==staged.end()?0:it->second.size()),"E_STUDIO_OFFSET");
    const auto& hex=request["hex"].get_ref<const std::string&>();
    require(!hex.empty() && hex.size()%2==0,"E_STUDIO_HEX");
    require(hex.size()<=65536 && hex.size()/2<=limit-bytes &&
            (it!=staged.end() || staged.size()<21),"E_STUDIO_LIMIT");
    r02::Bytes chunk;
    chunk.reserve(hex.size()/2);
    for (std::size_t i=0; i<hex.size(); i+=2)
        chunk.push_back(static_cast<std::uint8_t>(digit(hex[i])*16+digit(hex[i+1])));
    if (it==staged.end()) staged.emplace(id,std::move(chunk));
    else it->second.insert(it->second.end(),chunk.begin(),chunk.end());
    bytes+=hex.size()/2;
}

CellSpec cell_spec(const Json& bindings, const Json& params, const Files& staged) {
    require(fields(bindings,{"map","loft","datasets","sprite"}),"E_STUDIO_BINDING");
    require(fields(params,{"tile","part","material","frameSlot","tabBits","paletteIndex"}),"E_STUDIO_REQUEST");
    std::set<std::string> used;
    const auto file=[&](const Json& value) {
        auto id=identifier(value);
        require(staged.contains(id) && used.insert(id).second,"E_STUDIO_BINDING");
        return id;
    };
    CellSpec cell;
    cell.map=file(bindings["map"]);
    cell.loft=file(bindings["loft"]);
    const auto& sets=bindings["datasets"];
    require(sets.is_array() && !sets.empty() && sets.size()<=16,"E_STUDIO_BINDING");
    std::set<std::string> dataset_ids;
    for (const auto& item:sets) {
        require(fields(item,{"id","file"}),"E_STUDIO_BINDING");
        auto id=identifier(item["id"]);
        require(dataset_ids.insert(id).second,"E_STUDIO_BINDING");
        cell.datasets.push_back({std::move(id),file(item["file"])});
    }
    const auto& sprite=bindings["sprite"];
    require(fields(sprite,{"dataset","pck","tab","palette"}),"E_STUDIO_BINDING");
    cell.sprite_dataset=identifier(sprite["dataset"]);
    require(dataset_ids.contains(cell.sprite_dataset),"E_STUDIO_BINDING");
    cell.pck=file(sprite["pck"]);
    cell.tab=file(sprite["tab"]);
    cell.palette=file(sprite["palette"]);
    require(used.size()==staged.size(),"E_STUDIO_BINDING");
    const auto& tile=params["tile"];
    require(tile.is_array() && tile.size()==3,"E_STUDIO_REQUEST");
    for (std::size_t i=0; i<3; ++i)
        cell.tile[i]=static_cast<int>(bounded(tile[i],254,"E_R03_TILE_BOUNDS"));
    static constexpr std::array<std::string_view,4> names{"floor","west_wall","north_wall","object"};
    require(params["part"].is_string(),"E_STUDIO_PART");
    auto part=std::ranges::find(names,std::string_view(params["part"].get_ref<const std::string&>()));
    require(part!=names.end(),"E_STUDIO_PART");
    cell.part=static_cast<std::size_t>(part-names.begin());
    cell.material=identifier(params["material"]);
    require(cell.material[0]>='a' && cell.material[0]<='z' &&
            std::ranges::all_of(cell.material,[](char c) {return (c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='_';}),
            "E_STUDIO_MATERIAL");
    cell.slot=bounded(params["frameSlot"],7,"E_STUDIO_FRAME");
    cell.tab_bits=static_cast<unsigned>(bounded(params["tabBits"],32,"E_R04_ARGUMENTS"));
    require(cell.tab_bits==16 || cell.tab_bits==32,"E_R04_ARGUMENTS");
    cell.palette_index=bounded(params["paletteIndex"],8191,"E_R04_PALETTE_LENGTH");
    return cell;
}

Json parse(std::string_view text, const char* code) {
    require(text.find('\0') == std::string_view::npos, code);
    using Event = Json::parse_event_t;
    std::map<int,std::set<std::string>> keys;
    try {
        return Json::parse(text.begin(), text.end(), [&](int depth, Event event, Json& value) {
            require(depth <= 32, "E_STUDIO_LIMIT");
            if (event == Event::object_start) keys[depth+1].clear();
            if (event == Event::key)
                require(keys[depth].insert(value.get<std::string>()).second, code);
            return true;
        });
    } catch (const Json::exception&) {
        throw ProtocolError{code};
    }
}

void check_package(std::string_view bytes, std::string_view seed) {
    const auto package = parse(bytes, "E_STUDIO_MODEL");
    require(package.is_object() && package.contains("model"), "E_STUDIO_MODEL");
    const auto& model = package.at("model");
    require(model.is_object() && model.contains("contributions") && model.contains("seed"),
            "E_STUDIO_MODEL");
    const auto& package_seed = model.at("seed");
    require(package_seed.is_string() && package_seed.get_ref<const std::string&>() == seed,
            "E_STUDIO_BINDING");
    const auto& parts = model.at("contributions");
    require(parts.is_array() && !parts.empty(), "E_STUDIO_MODEL");
    require(parts.size() == 1, "E_STUDIO_LIMIT");
    const auto& field = parts.at(0).at("field");
    require(field.is_object() && field.contains("op"), "E_STUDIO_MODEL");
    require(field.at("op") == "program", "E_STUDIO_PROFILE");
    const auto& nodes = field.at("program").at("nodes");
    require(nodes.is_array(), "E_STUDIO_MODEL");
    require(nodes.size() <= 8, "E_STUDIO_LIMIT");
    // C05 sphere uses platform libm. At a cell centre on the zero level,
    // even one ULP can change the boolean occupancy between targets.
    static constexpr std::array<std::string_view,8> operations{
        "constant","parameter","box","translate","union","intersection","subtract","material"};
    for (const auto& node : nodes) {
        const auto& operation = node.at("op");
        require(operation.is_string(), "E_STUDIO_MODEL");
        const std::string_view name = operation.get_ref<const std::string&>();
        require(std::ranges::find(operations,name) != operations.end(), "E_STUDIO_PROFILE");
    }
}
}

std::string Runner::call(std::string_view input) {
    static constexpr std::array names{"READY","RUNNING","PAUSED","COMPLETED","FAILED","CANCELLED"};
    const auto response = [&] {
        return Json{{"v",1},{"state",names[static_cast<std::size_t>(state_)]},{"runId",run_id_}};
    };
    const auto failure = [&](const char* code) {
        auto reply = response();
        reply["error"] = code;
        return reply.dump();
    };
    const auto begin_run = [&] {
        result_={};
        whole_result_.clear();
        cell_result_.reset();
        build_result_.reset();
        ++run_id_;
        state_=State::running;
        return response().dump();
    };
    try {
        require(input.size() <= max_request, "E_STUDIO_LIMIT");
        const auto request = parse(input,"E_STUDIO_REQUEST");
        require(request.is_object() && request.contains("v") && request.contains("action"),
                "E_STUDIO_REQUEST");
        require(request["v"].is_number_integer() && request["v"] == 1, "E_STUDIO_VERSION");
        require(request["action"].is_string(), "E_STUDIO_REQUEST");
        const auto& action = request["action"].get_ref<const std::string&>();
        if (action == "status") {
            require(fields(request,{"v","action"}), "E_STUDIO_REQUEST");
            return response().dump();
        }
        if (action=="catalog-directory" || action=="catalog-map") {
            auto reply=response();
            if (action=="catalog-directory") {
                require(fields(request,{"v","action","paths"}),"E_STUDIO_REQUEST");
                reply["catalog"]=catalog_directory(request["paths"]);
            } else {
                require(state_!=State::running && state_!=State::paused,"E_STUDIO_STATE");
                require(fields(request,{"v","action","map"}),"E_STUDIO_REQUEST");
                reply["catalog"]=catalog_map(identifier(request["map"]),staged_);
            }
            return reply.dump();
        }
        if (action=="append" || action=="clear") {
            require(state_!=State::running && state_!=State::paused,"E_STUDIO_STATE");
            if (action=="append") append_file(request,staged_,staged_size_);
            else {
                require(fields(request,{"v","action"}),"E_STUDIO_REQUEST");
                staged_.clear();
                staged_size_=0;
            }
            return response().dump();
        }
        if (action == "start") {
            require(state_ != State::running && state_ != State::paused, "E_STUDIO_STATE");
            require(fields(request,{"v","action","spec"}), "E_STUDIO_REQUEST");
            const auto& spec = request["spec"];
            if (spec.is_object() && spec.contains("algorithm") && spec["algorithm"]=="r06-cell/1") {
                require(fields(spec,{"algorithm","coreRevision","budget","sourceBindings","parameters"}),
                        "E_STUDIO_REQUEST");
                require(spec["coreRevision"]==FGMR_CORE_REVISION,"E_STUDIO_VERSION");
                require(spec["budget"].is_number_integer() && spec["budget"]==voxel_count,"E_STUDIO_BUDGET");
                require(run_id_<std::numeric_limits<std::uint32_t>::max(),"E_STUDIO_LIMIT");
                auto cell=cell_spec(spec["sourceBindings"],spec["parameters"],staged_);
                spec_={{},{},{},std::move(cell),std::move(staged_)};
                staged_.clear();
                staged_size_=0;
                return begin_run();
            }
            if (spec.is_object() && spec.contains("algorithm") && spec["algorithm"]=="r06-whole-build/1") {
                require(fields(spec,{"algorithm","coreRevision","budget","sourceBindings","parameters"}),
                        "E_STUDIO_REQUEST");
                require(spec["coreRevision"]==FGMR_CORE_REVISION,"E_STUDIO_VERSION");
                require(fields(spec["parameters"],{"material"}),"E_STUDIO_REQUEST");
                require(run_id_<std::numeric_limits<std::uint32_t>::max(),"E_STUDIO_LIMIT");
                RunSpec next;
                next.material=identifier(spec["parameters"]["material"]);
                require(next.material[0]>='a' && next.material[0]<='z' &&
                        std::ranges::all_of(next.material,[](char ch) {
                            return (ch>='a'&&ch<='z')||(ch>='0'&&ch<='9')||ch=='_';
                        }),"E_STUDIO_MATERIAL");
                next.build=build_spec(spec["sourceBindings"],spec["budget"],staged_);
                next.files=std::move(staged_);
                staged_.clear();
                staged_size_=0;
                spec_=std::move(next);
                return begin_run();
            }
            if (spec.is_object() && spec.contains("algorithm") && spec["algorithm"]=="r06-whole-sample/1") {
                require(fields(spec,{"algorithm","coreRevision","seed","budget","sourceBindings","parameters"}),
                        "E_STUDIO_REQUEST");
                require(spec["coreRevision"]==FGMR_CORE_REVISION,"E_STUDIO_VERSION");
                const auto& bindings=spec["sourceBindings"];
                require(bindings.is_array() && bindings.size()==1 &&
                        fields(bindings[0],{"role","bytes"}) && bindings[0]["role"]=="model" &&
                        bindings[0]["bytes"].is_string(),"E_STUDIO_BINDING");
                const auto& package=bindings[0]["bytes"].get_ref<const std::string&>();
                require(!package.empty() && package.size()<=48*1024,"E_STUDIO_LIMIT");
                const auto& settings=spec["parameters"];
                require(fields(settings,{"material","cells"}),"E_STUDIO_REQUEST");
                const auto material=identifier(settings["material"]);
                require(material[0]>='a' && material[0]<='z' &&
                        std::ranges::all_of(material,[](char ch) {
                            return (ch>='a'&&ch<='z')||(ch>='0'&&ch<='9')||ch=='_';
                        }),"E_STUDIO_MATERIAL");
                const auto& cells=settings["cells"];
                require(cells.is_array() && cells.size()>=2 && cells.size()<=8,
                        "E_STUDIO_LIMIT");
                std::vector<std::array<int,3>> locals;
                std::set<std::array<int,3>> unique_cells;
                for(const auto& entry:cells) {
                    require(fields(entry,{"local_xyz"}) && entry["local_xyz"].is_array() &&
                            entry["local_xyz"].size()==3,"E_STUDIO_BINDING");
                    std::array<int,3> local{};
                    for(std::size_t axis=0;axis<3;++axis) {
                        const auto& coord=entry["local_xyz"][axis];
                        require(coord.is_number_integer(),"E_STUDIO_BINDING");
                        const auto value=coord.get<std::int64_t>();
                        require(value>=-16 && value<=16,"E_STUDIO_BINDING");
                        local[axis]=static_cast<int>(value);
                    }
                    require(unique_cells.insert(local).second,"E_STUDIO_BINDING");
                    locals.push_back(local);
                }
                require(spec["budget"].is_number_integer() &&
                        spec["budget"] == voxel_count*locals.size(),"E_STUDIO_BUDGET");
                require(spec["seed"].is_string(),"E_STUDIO_BINDING");
                const auto& seed=spec["seed"].get_ref<const std::string&>();
                require(seed.size()==64,"E_STUDIO_BINDING");
                const auto pkg=parse(package,"E_STUDIO_MODEL");
                require(pkg.is_object() && pkg.contains("format") &&
                        pkg["format"]=="fgm-package/1" && pkg.contains("generation") &&
                        pkg["generation"].is_object() &&
                        pkg["generation"].value("algorithm",std::string{})=="r06_multicell_loft_boxes" &&
                        pkg["generation"].value("version",std::string{})=="0.1.0" &&
                        pkg.contains("model") && pkg["model"].is_object() &&
                        pkg["model"].contains("seed") && pkg["model"]["seed"]==seed,
                        "E_STUDIO_MODEL");
                require(run_id_<std::numeric_limits<std::uint32_t>::max(),"E_STUDIO_LIMIT");
                RunSpec next;
                next.package=package;
                next.seed=seed;
                next.material=material;
                next.whole_cells=std::move(locals);
                next.whole=true;
                spec_=std::move(next);
                staged_.clear();
                staged_size_=0;
                return begin_run();
            }
            require(fields(spec,{"algorithm","coreRevision","seed","budget","sourceBindings","parameters"}),
                    "E_STUDIO_REQUEST");
            require(spec["algorithm"] == "r06-occupancy/1" && spec["coreRevision"] == FGMR_CORE_REVISION,
                    "E_STUDIO_VERSION");
            require(spec["budget"].is_number_integer() && spec["budget"] == voxel_count, "E_STUDIO_BUDGET");
            const auto& bindings = spec["sourceBindings"];
            require(bindings.is_array() && bindings.size() == 1 && fields(bindings[0],{"role","bytes"}) &&
                    bindings[0]["role"] == "model" && bindings[0]["bytes"].is_string(),
                    "E_STUDIO_BINDING");
            const auto& package = bindings[0]["bytes"].get_ref<const std::string&>();
            require(!package.empty() && package.size() <= 32*1024, "E_STUDIO_LIMIT");
            const auto& parameters = spec["parameters"];
            require(fields(parameters,{"material"}) && parameters["material"].is_string() &&
                    spec["seed"].is_string(), "E_STUDIO_REQUEST");
            const auto& seed = spec["seed"].get_ref<const std::string&>();
            const auto& material = parameters["material"].get_ref<const std::string&>();
            require(seed.size() == 64 && !material.empty() && material.size() <= 64, "E_STUDIO_LIMIT");
            require(run_id_ < std::numeric_limits<std::uint32_t>::max(), "E_STUDIO_LIMIT");
            spec_ = {package,seed,material,std::nullopt,{}};
            return begin_run();
        }

        if (action=="read-build")
            require(fields(request,{"v","action","runId","artifact","offset"}),"E_STUDIO_REQUEST");
        else require(fields(request,{"v","action","runId"}),"E_STUDIO_REQUEST");
        require(run_id_ != 0 && request["runId"].is_number_unsigned() && request["runId"] == run_id_,
                "E_STUDIO_RUN");
        if (action=="read-build") {
            require(state_==State::completed && build_result_.has_value(),"E_STUDIO_STATE");
            require(request["artifact"].is_string(),"E_STUDIO_REQUEST");
            const auto& artifact=request["artifact"].get_ref<const std::string&>();
            const auto entry=std::ranges::find_if(build_artifacts,[&](const auto& item) {
                return item.first==artifact;
            });
            require(entry!=build_artifacts.end(),"E_STUDIO_BINDING");
            const auto& bytes=(*build_result_).*entry->second;
            const auto offset=bounded(request["offset"],bytes.size(),"E_STUDIO_OFFSET");
            const auto length=std::min(build_chunk_size,bytes.size()-offset);
            auto reply=response();
            reply["chunk"]={{"artifact",artifact},{"offset",offset},
                            {"bytes",bytes.substr(offset,length)},{"eof",offset+length==bytes.size()}};
            return reply.dump();
        }
        if (action == "pause") {
            require(state_ == State::running, "E_STUDIO_STATE");
            state_ = State::paused;
        } else if (action == "resume") {
            require(state_ == State::paused, "E_STUDIO_STATE");
            state_ = State::running;
        } else if (action == "cancel") {
            require(state_ == State::running || state_ == State::paused, "E_STUDIO_STATE");
            state_ = State::cancelled;
            spec_ = {};
        } else if (action == "step") {
            require(state_ == State::running, "E_STUDIO_STATE");
            state_ = State::failed;
            auto spec = std::move(spec_);
            spec_ = {};
            if (spec.cell) {
                cell_result_=reconstruct_cell(*spec.cell,spec.files);
                state_=State::completed;
                return response().dump();
            }
            if (spec.build) {
                try {
                    build_result_=build_from_files(*spec.build,spec.files,spec.material);
                } catch (const std::runtime_error& error) {
                    return failure(std::string_view(error.what())=="E_S43_BUILD_LIMIT"
                                   ? "E_STUDIO_LIMIT" : "E_STUDIO_BUILD");
                }
                state_=State::completed;
                return response().dump();
            }
            if (spec.whole) {
                try {
                    whole_result_=sample_whole(spec.package,spec.material,spec.whole_cells);
                } catch (const std::exception&) {
                    return failure("E_STUDIO_WHOLE");
                }
                state_=State::completed;
                return response().dump();
            }
            try {
                check_package(spec.package,spec.seed);
                const auto model = fgm::Evaluator::from_package(spec.package);
                result_ = sample_occupancy(model,spec.material);
            } catch (const fgm::Error& error) {
                const auto code = std::string_view(error.what()) == "E_R06_MATERIAL"
                    ? "E_STUDIO_MATERIAL" : "E_STUDIO_MODEL";
                return failure(code);
            } catch (const Json::exception&) {
                return failure("E_STUDIO_MODEL");
            }
            state_ = State::completed;
        } else if (action == "finalize") {
            require(state_ == State::completed, "E_STUDIO_STATE");
            auto reply = response();
            if (cell_result_) {
                const auto& cell=*cell_result_;
                reply["result"]={{"model",cell.model},{"preview",cell.preview},{"report",cell.report},
                                 {"proof",cell.proof},{"visual",cell.visual}};
            } else if (build_result_) {
                auto artifacts=Json::array();
                for (const auto& [name,member] : build_artifacts) {
                    const auto& bytes=(*build_result_).*member;
                    artifacts.push_back({{"name",name},{"size",bytes.size()},{"sha256",sha256(bytes)}});
                }
                reply["result"]={{"build",{{"artifacts",std::move(artifacts)}}}};
            } else if (!whole_result_.empty())
                reply["result"]={{"whole",Json::parse(whole_result_)}};
            else reply["result"] = {{"mask",result_.mask},{"occupied",result_.occupied},{"samples",voxel_count}};
            return reply.dump();
        } else {
            throw ProtocolError{"E_STUDIO_REQUEST"};
        }
        return response().dump();
    } catch (const ProtocolError& error) {
        return failure(error.code);
    } catch (const CellError& error) {
        return failure(error.code);
    } catch (const CatalogError& error) {
        return failure(error.code);
    } catch (const Json::exception&) {
        return failure("E_STUDIO_REQUEST");
    } catch (const std::bad_alloc&) {
        return failure("E_STUDIO_MEMORY");
    } catch (const std::runtime_error& error) {
        const std::string_view code=error.what();
        return failure(code.starts_with("E_R02_") || code.starts_with("E_R03_") || code.starts_with("E_R04_")
                       ? error.what() : "E_STUDIO_RECONSTRUCT");
    }
}
}
