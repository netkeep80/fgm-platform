#include "fitted-surface.hpp"
#include "sha256.hpp"
#include "whole-observation.hpp"
#include "projection.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <iomanip>
#include <locale>
#include <set>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace fgmr {
namespace {
using Json = nlohmann::json;
using Vec = std::array<double,3>;
struct Box { Vec lo,hi; };
struct Rect { double a,b,c,d; };
void need(bool ok,const char* code) { if(!ok)throw std::runtime_error(code); }
bool fields(const Json& v,std::initializer_list<std::string_view> keys) {
    if(!v.is_object()||v.size()!=keys.size())return false;
    return std::ranges::all_of(keys,[&](auto k){return v.contains(std::string(k));});
}
Json parse(std::string_view bytes) {
    std::array<std::set<std::string>,33> keys;
    using Event=Json::parse_event_t;
    return Json::parse(bytes.begin(),bytes.end(),[&](int depth,Event e,Json& v){
        need(depth<32,"E_FIT_JSON");
        if(e==Event::object_start)keys.at(static_cast<std::size_t>(depth+1)).clear();
        if(e==Event::key)need(keys.at(static_cast<std::size_t>(depth)).insert(v.get<std::string>()).second,"E_FIT_JSON");
        return true;
    });
}
std::string text(const Json& v){return v.dump(-1,' ',true);}
Vec vec(const Json& v) {
    need(v.is_array()&&v.size()==3,"E_FIT_GRAMMAR");
    Vec out{};
    for(std::size_t a=0;a<3;++a) {
        need(v[a].is_number(),"E_FIT_GRAMMAR");out[a]=v[a].get<double>();
        need(std::isfinite(out[a])&&std::abs(out[a])<=10000,"E_FIT_RANGE");
    }
    return out;
}
bool near(double a,double b){return std::abs(a-b)<1e-9;}
// Check the existing R07 derivation, rather than introducing a second evaluator.
// The authoritative baseline was built by BuildWholeObject from the pinned inputs.
std::vector<Box> boxes(const Json& base,const Json& model,bool unchanged) {
    const auto& bg=base.at("generation");
    const auto& gen=model.at("generation");
    const auto& bm=base.at("model");
    const auto& m=model.at("model");
    need(model.at("format")==base.at("format")&&model.at("interpreter")==base.at("interpreter")&&
         fields(model,{"format","interpreter","generation","model"})&&
         fields(m,{"seed","volumes","contributions"})&&m.at("volumes")==bm.at("volumes")&&
         m.at("contributions").size()==1,"E_FIT_GRAMMAR");
    Vec delta{};bool translation=false;
    if(!unchanged) {
        need(fields(gen,{"algorithm","version","parameters","resources"})&&gen.at("version")=="0.1.0","E_FIT_DERIVATION");
        auto resources=gen.at("resources");
        need(resources.at("baseline_package")==sha256(text(base)),"E_FIT_BASELINE");
        resources.erase("baseline_package");need(resources==bg.at("resources"),"E_FIT_MEMBERSHIP");
        const auto& alg=gen.at("algorithm");const auto& p=gen.at("parameters");
        if(alg=="r07_s1b1b1a_joint_extent") {
            need(fields(p,{"delta"})&&p.at("delta").is_number(),"E_FIT_DERIVATION");
            const auto d=p.at("delta").get<double>();
            need(near(std::abs(d),.49)||near(std::abs(d),.98),"E_FIT_DERIVATION");delta={d,d,d};
        } else {
            translation=alg=="r07_s1b1b1c_joint_xyz_offset";
            need(translation||alg=="r07_s1b1b1c_joint_xyz_extent","E_FIT_DERIVATION");
            const auto key=translation?"offset_xyz":"delta_xyz";
            need(fields(p,{key}),"E_FIT_DERIVATION");delta=vec(p.at(key));
            for(auto d:delta)need(near(d,0)||near(std::abs(d),.49),"E_FIT_DERIVATION");
            need(translation?(delta!=Vec{}):!(near(delta[0],delta[1])&&near(delta[1],delta[2])),"E_FIT_DERIVATION");
        }
        need(m.at("seed")==sha256(text(Json::array({"fgm:seed:1",{{"generation",gen},{"purpose","model"}}}))),"E_FIT_SEED");
    } else need(gen==bg&&m==bm,"E_FIT_DERIVATION");
    auto expected=bm;expected["seed"]=m.at("seed");
    auto& nodes=expected["contributions"][0]["field"]["program"]["nodes"];
    const auto& actual=m.at("contributions")[0].at("field").at("program").at("nodes");
    need(actual.is_array()&&actual.size()==nodes.size(),"E_FIT_GRAMMAR");
    std::vector<Box> out;
    for(std::size_t i=0;i<nodes.size()&&nodes[i].at("op")=="constant";i+=4) {
        need(out.size()<128&&i+3<nodes.size(),"E_FIT_LIMIT");
        const auto extent=vec(nodes[i].at("value")),offset=vec(nodes[i+1].at("value"));
        auto e=extent,o=offset;
        for(std::size_t a=0;a<3;++a) {
            if(translation)o[a]=std::round((o[a]+delta[a])*1000)/1000;
            else e[a]=std::round((e[a]+delta[a])*1000)/1000;
            need(e[a]>=.5&&e[a]<=512&&std::abs(o[a])<=10000,"E_FIT_RANGE");
        }
        // Replace only the allowed common parameter vectors; compare the entire graph.
        nodes[i+(translation?1:0)]["value"]=translation?o:e;
        // Normalize exact millivoxel coordinates of the supported R06/R07 family.
        Box b{};for(std::size_t a=0;a<3;++a){
            b.lo[a]=std::round((o[a]-e[a])*1000)/1000;
            b.hi[a]=std::round((o[a]+e[a])*1000)/1000;
        }
        out.push_back(b);
    }
    need(!out.empty()&&expected==m,"E_FIT_GRAMMAR");
    return out;
}
// Exact exposed face rectangles for the supported continuous AABB union.
// Subtract occluding boxes on each face; ties give one coplanar owner.
// No sampling grid, no LOFT decoder and no field evaluation in this extractor.
std::string mesh(const std::vector<Box>& boxes) {
    std::ostringstream out;out.imbue(std::locale::classic());out<<std::setprecision(12);
    out<<"# R07 continuous box union; inferred surface, fgm-voxel\n";
    std::size_t vertex=0,operations=0;
    for(std::size_t i=0;i<boxes.size();++i)for(std::size_t a=0;a<3;++a)for(int sign:{-1,1}) {
        const auto u=(a+1)%3,v=(a+2)%3;const auto& b=boxes[i];
        const double plane=sign>0?b.hi[a]:b.lo[a];
        std::vector<Rect> pieces{{b.lo[u],b.hi[u],b.lo[v],b.hi[v]}};
        for(std::size_t j=0;j<boxes.size();++j) {
            if(i==j)continue;
            const auto& c=boxes[j];
            const bool covers=sign>0?(c.lo[a]<=plane&&c.hi[a]>plane):
                                       (c.lo[a]<plane&&c.hi[a]>=plane);
            const bool tied=j<i&&(sign>0?(c.hi[a]==plane&&c.lo[a]<plane):
                                         (c.lo[a]==plane&&c.hi[a]>plane));
            if(!covers&&!tied)continue;
            std::vector<Rect> next;
            for(const auto& r:pieces) {
                need(++operations<=2000000,"E_FIT_LIMIT");
                const double x0=std::max(r.a,c.lo[u]),x1=std::min(r.b,c.hi[u]);
                const double y0=std::max(r.c,c.lo[v]),y1=std::min(r.d,c.hi[v]);
                if(x0>=x1||y0>=y1){next.push_back(r);continue;}
                if(r.a<x0)next.push_back({r.a,x0,r.c,r.d});
                if(x1<r.b)next.push_back({x1,r.b,r.c,r.d});
                if(r.c<y0)next.push_back({x0,x1,r.c,y0});
                if(y1<r.d)next.push_back({x0,x1,y1,r.d});
            }
            need(next.size()<=8192,"E_FIT_LIMIT");pieces=std::move(next);
        }
        for(const auto& r:pieces) {
            need(vertex+4<=65536,"E_FIT_LIMIT");
            std::array<Vec,4> points{};
            for(std::size_t k=0;k<4;++k) {
                auto& p=points[k];p[a]=plane;p[u]=(k==1||k==2)?r.b:r.a;p[v]=k>=2?r.d:r.c;
            }
            if(sign<0)std::reverse(points.begin(),points.end());
            for(const auto& p:points)out<<"v "<<p[0]<<' '<<p[1]<<' '<<p[2]<<'\n';
            out<<"f "<<vertex+1<<' '<<vertex+2<<' '<<vertex+3<<'\n';
            out<<"f "<<vertex+1<<' '<<vertex+3<<' '<<vertex+4<<'\n';vertex+=4;
            need(out.tellp()<=768*1024,"E_FIT_LIMIT");
        }
    }
    return out.str();
}
using Pixel=std::array<int,2>;
std::set<Pixel> pixels(const Json& v) {
    need(v.is_array()&&v.size()<=1280,"E_FIT_OBSERVATION");std::set<Pixel> result;
    for(const auto& p:v) {
        need(p.is_array()&&p.size()==2,"E_FIT_OBSERVATION");Pixel xy{};
        for(std::size_t i=0;i<2;++i) {
            need(p[i].is_number_integer(),"E_FIT_OBSERVATION");const auto q=p[i].get<std::int64_t>();
            need(q>=-100000&&q<=100000,"E_FIT_OBSERVATION");xy[i]=static_cast<int>(q);
        }
        need(result.insert(xy).second,"E_FIT_OBSERVATION");
    }
    return result;
}
Json scores(const Json& observations,const Json& input) {
    Json cells=Json::array();std::size_t all_common=0,all_union=0;
    for(std::size_t i=0;i<input.size();++i) {
        const auto& obs=input[i].at("observed_pixels_xy");if(obs.is_null())continue;
        const auto known=pixels(obs),pred=pixels(observations.at("cells")[i].at("surface_pixels_xy"));
        std::size_t common=0;for(const auto& p:known)if(pred.contains(p))++common;
        const auto united=known.size()+pred.size()-common;
        cells.push_back({{"common",common},{"union",united},{"observed",known.size()},{"predicted",pred.size()}});
        all_common+=common;all_union+=united;
    }
    need(cells.size()>=2,"E_FIT_OBSERVATION");
    return {{"cells",cells},{"micro",{{"common",all_common},{"union",all_union}}}};
}
bool nonworse(const Json& a,const Json& b) {
    const auto ac=a.at("common").get<std::uint64_t>(),au=a.at("union").get<std::uint64_t>();
    const auto bc=b.at("common").get<std::uint64_t>(),bu=b.at("union").get<std::uint64_t>();
    return au&&bu?ac*bu>=bc*au:au==bu;
}
} // namespace

WholeBuildResult fitted_surface(WholeBuildResult baseline,WholeBuildSource input) {
    try {
        need(!input.bytes.empty()&&input.bytes.size()<=256*1024,"E_FIT_LIMIT");
        need(sha256(input.bytes)==input.expected_sha256,"E_FIT_INPUT_SHA");
        const auto in=parse(input.bytes);
        need(fields(in,{"schema","baseline_sha256","membership_sha256","winner_package","winner_sha256","cells","fit_receipt"})&&
             in.at("schema")=="fgmr-r07-fit-preview-input/1","E_FIT_INPUT");
        auto report=parse(baseline.report),proof=parse(baseline.input_proof);
        const auto base=parse(baseline.package),slices=parse(baseline.slices);
        const auto baseline_sha=sha256(baseline.package);
        need(in.at("baseline_sha256")==baseline_sha,"E_FIT_BASELINE");
        need(in.at("membership_sha256")==report.at("membership_sha256"),"E_FIT_MEMBERSHIP");
        need(in.at("winner_package").is_string(),"E_FIT_INPUT");
        const auto package=in.at("winner_package").get<std::string>();
        need(in.at("winner_sha256")==sha256(package),"E_FIT_PACKAGE_SHA");
        const auto model=parse(package);need(text(model)==package,"E_FIT_CANONICAL");
        const auto bounds=boxes(base,model,package==baseline.package);
        const auto& cells=in.at("cells");
        need(cells.is_array()&&cells.size()==slices.at("cells").size(),"E_FIT_CELLS");
        auto clean=Json::array();
        for(std::size_t i=0;i<cells.size();++i) {
            const auto& c=cells[i];const auto& s=slices.at("cells")[i];
            need(fields(c,{"tile","local_xyz","reference_rows","reference_rows_sha256","p_level","right_half","observed_pixels_xy","observed_sha256"})&&
                 c.at("tile")==s.at("xyz")&&c.at("local_xyz")==s.at("local_xyz"),"E_FIT_CELLS");
            auto rows=Json::array();for(const auto& layer:s.at("rows"))for(const auto& row:layer)rows.push_back(row);
            need(c.at("reference_rows")==rows&&c.at("reference_rows_sha256")==sha256(text(rows)),"E_FIT_ROWS");
            const auto& obs=c.at("observed_pixels_xy");
            if(obs.is_null())need(c.at("observed_sha256").is_null(),"E_FIT_OBSERVATION");
            else need(!pixels(obs).empty()&&c.at("observed_sha256")==sha256(text(obs)),"E_FIT_OBSERVATION");
            clean.push_back({{"tile",c.at("tile")},{"local_xyz",c.at("local_xyz")},{"reference_rows",rows},
                             {"p_level",c.at("p_level")},{"right_half",c.at("right_half")}});
        }
        const auto material=base.at("model").at("contributions")[0].at("material");
        auto request=Json{{"schema","fgmr-r07-whole-surface-request/1"},{"package",baseline.package},
                          {"package_sha256",baseline_sha},{"material",material},{"cells",clean}};
        const auto before=observe_whole(request);
        request["package"]=package;request["package_sha256"]=sha256(package);
        // Hard C05 in the same Core sampler runs before any candidate raster/mesh result.
        const auto after=observe_whole(request);
        const auto b=scores(before,cells),w=scores(after,cells);
        for(std::size_t i=0;i<w.at("cells").size();++i)
            need(nonworse(w.at("cells")[i],b.at("cells")[i]),"E_FIT_REGRESSION");
        const auto& receipt=in.at("fit_receipt");
        need(receipt.at("baseline_sha256")==baseline_sha&&receipt.at("winner_sha256")==sha256(package)&&
             receipt.at("membership_sha256")==in.at("membership_sha256"),"E_FIT_RECEIPT");
        for(const auto& key:{"cells","micro"})
            need(receipt.at("baseline_loss").at(key)==b.at(key)&&receipt.at("winner_loss").at(key)==w.at(key),"E_FIT_METRICS");
        const auto baseline_mesh_sha=sha256(baseline.preview);
        baseline.package=package;baseline.preview=mesh(bounds);
        report["model_sha256"]=sha256(package);report["preview_sha256"]=sha256(baseline.preview);
        report["surface"]="r07_continuous_box_union_exposed_faces/1";
        auto observations=Json::array();
        for(std::size_t i=0;i<cells.size();++i) {
            const auto tile=cells[i].at("tile").get<std::array<int,3>>();
            const auto origin=r05::spriteAnchor({tile[0],tile[1],tile[2]},cells[i].at("p_level").get<std::uint8_t>());
            observations.push_back({{"tile",tile},{"sprite_origin_xy",Json::array({origin.x,origin.y})},
                {"observed_pixels_xy",cells[i].at("observed_pixels_xy")},
                {"before_pixels_xy",before.at("cells")[i].at("surface_pixels_xy")},
                {"after_pixels_xy",after.at("cells")[i].at("surface_pixels_xy")}});
        }
        report["fit"]={{"input_sha256",input.expected_sha256},{"baseline_sha256",baseline_sha},
            {"baseline_mesh_sha256",baseline_mesh_sha},
            {"receipt_sha256",sha256(text(receipt))},{"before",b},{"after",w},
            {"observations",observations},
            {"strict_iou_improvement",!nonworse(b.at("micro"),w.at("micro"))},
            {"metric_scope","shared_R07_cell_rays_conditional_on_imported_observations"},
            {"raster",after.at("raster")},{"source_attestation","NOT_INDEPENDENTLY_VERIFIED"},
            {"stage_a","NOT_ACCEPTED"},{"private_acceptance","PENDING"}};
        proof["package_sha256"]=sha256(package);proof["fitted_input_sha256"]=input.expected_sha256;
        proof["baseline_package_sha256"]=baseline_sha;
        proof["verification_scope"]="transport_integrity_binding_c05_r07_derivation_and_metric_replay";
        baseline.report=text(report);baseline.input_proof=text(proof);return baseline;
    } catch(const Json::exception&) {throw std::runtime_error("E_FIT_INPUT");}
}
} // namespace fgmr
