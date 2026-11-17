#include "map-facts.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace r02 {
namespace {
constexpr std::size_t kMcdBytes = 62;
constexpr std::array<std::string_view,4> kParts{"floor","west_wall","north_wall","object"};
void require(bool predicate,const char* message) {
    if (!predicate) throw std::runtime_error(message);
}
void escaped(std::ostream& out,std::string_view value) {
    out << '"';
    constexpr char hex[]="0123456789abcdef";
    for (unsigned char c:value) {
        if (c=='"' || c=='\\') {out << '\\' << static_cast<char>(c);}
        else if (c=='\n') out << "\\n";
        else if (c=='\r') out << "\\r";
        else if (c=='\t') out << "\\t";
        else if (c<32) out << "\\u00" << hex[c>>4] << hex[c&15];
        else out << static_cast<char>(c);
    }
    out << '"';
}
void array(std::ostream& out, const std::uint8_t* data, std::size_t n) {
    out << '[';
    for (std::size_t i=0;i<n;++i) {
        if (i) out << ',';
        out << unsigned(data[i]);
    }
    out << ']';
}
std::string hexValue(const std::uint8_t* start,std::size_t length) {
    constexpr char digits[]="0123456789abcdef";
    std::string result;
    result.reserve(length*2);
    for (std::size_t i=0;i<length;++i) {
        result.push_back(digits[start[i]>>4]);
        result.push_back(digits[start[i]&15]);
    }
    return result;
}
bool safeId(const std::string& id) {
    if (id.empty() || id.size()>48) return false;
    for (unsigned char c:id) {
        if (!((c>='A'&&c<='Z') || (c>='a'&&c<='z') ||
              (c>='0'&&c<='9') || c=='_' || c=='-')) return false;
    }
    return true;
}
int signedByte(std::uint8_t raw) {
    return raw<128 ? int(raw) : int(raw)-256;
}
} // namespace

RecordReference resolveRecord(const std::vector<DataSet>& sets, std::size_t id) {
    for (std::size_t i=0;i<sets.size();++i) {
        const auto count=sets[i].bytes.size()/kMcdBytes;
        if (id<count) return {i,id};
        id-=count;
    }
    throw std::runtime_error("E_R02_MAP_INDEX_OUT_OF_RANGE");
}

Map decodeMap(const Bytes& raw) {
    require(raw.size()>=3,"E_R02_MAP_HEADER");
    Map map;
    map.sizeY=raw[0];
    map.sizeX=raw[1];
    map.sizeZ=raw[2];
    require(map.sizeX!=0 && map.sizeY!=0 && map.sizeZ!=0,"E_R02_MAP_DIMENSION");
    const std::size_t count=std::size_t(map.sizeX)*map.sizeY*map.sizeZ;
    require(raw.size()==3+4*count,"E_R02_MAP_LENGTH");
    map.tiles.reserve(count);
    const std::size_t plane=std::size_t(map.sizeX)*map.sizeY;
    for (std::size_t i=0;i<count;++i) {
        Tile tile;
        tile.recordIndex=i;
        tile.x=static_cast<int>(i % map.sizeX);
        tile.y=static_cast<int>((i/ map.sizeX) % map.sizeY);
        tile.z=static_cast<int>(map.sizeZ-1-i/plane);
        std::copy_n(raw.begin()+static_cast<std::ptrdiff_t>(3+4*i),4,tile.parts.begin());
        map.tiles.push_back(tile);
    }
    return map;
}
Bytes encodeMap(const Map& map) {
    require(map.sizeX!=0 && map.sizeY!=0 && map.sizeZ!=0,"E_R02_MAP_DIMENSION");
    const std::size_t count=std::size_t(map.sizeX)*map.sizeY*map.sizeZ;
    require(map.tiles.size()==count,"E_R02_ROUNDTRIP_TILE_COUNT");
    Bytes raw;
    raw.reserve(3+4*count);
    raw.push_back(map.sizeY);
    raw.push_back(map.sizeX);
    raw.push_back(map.sizeZ);
    const std::size_t plane=std::size_t(map.sizeX)*map.sizeY;
    for(std::size_t i=0;i<count;++i) {
        const Tile& tile=map.tiles[i];
        require(tile.recordIndex==i &&
                tile.x==int(i%map.sizeX) &&
                tile.y==int((i/map.sizeX)%map.sizeY) &&
                tile.z==int(map.sizeZ-1-i/plane),
                "E_R02_ROUNDTRIP_ORDER");
        raw.insert(raw.end(),tile.parts.begin(),tile.parts.end());
    }
    return raw;
}
Facts decode(const Bytes& raw, const std::vector<DataSet>& datasets) {
    require(!datasets.empty() && datasets.size()<=16,"E_R02_DATASET_COUNT");
    Facts result;
    result.map=decodeMap(raw);
    result.datasets=datasets;
    for(std::size_t i=0;i<datasets.size();++i) {
        const DataSet& set=datasets[i];
        require(safeId(set.id),"E_R02_DATASET_NAME");
        for(std::size_t j=0;j<i;++j)
            require(datasets[j].id!=set.id,"E_R02_DUPLICATE_DATASET");
        require(!set.bytes.empty() && set.bytes.size()%kMcdBytes==0,
                "E_R02_MCD_ALIGNMENT");
        const std::size_t count=set.bytes.size()/kMcdBytes;
        for(std::size_t j=0;j<count;++j) {
            const std::uint8_t* rec=set.bytes.data()+j*kMcdBytes;
            require(rec[42]!=0,"E_R02_MCD_ZERO_ARMOR");
            require(rec[44]<count && rec[46]<count,"E_R02_MCD_LOCAL_REFERENCE");
        }
    }
    for (const Tile& tile:result.map.tiles)
        for (std::uint8_t byte:tile.parts)
            if (byte!=0) (void)resolveRecord(result.datasets,byte);
    require(encodeMap(result.map)==raw,"E_R02_ROUNDTRIP_MAP");
    return result;
}
std::string toJson(const Facts& facts) {
    std::ostringstream out;
    out << "{\"schema\":\"fgm-regenerator/map-mcd-facts-v1\","
        << "\"map\":{\"header_yxz\":";
    const std::array<std::uint8_t,3> head{
        facts.map.sizeY,facts.map.sizeX,facts.map.sizeZ
    };
    array(out,head.data(),head.size());
    out << ",\"dimensions_xyz\":["<<unsigned(facts.map.sizeX)<<','
        <<unsigned(facts.map.sizeY)<<','<<unsigned(facts.map.sizeZ)<<"],\"tiles\":[";
    for (std::size_t i=0;i<facts.map.tiles.size();++i) {
        if(i) out<<',';
        const Tile& t=facts.map.tiles[i];
        out<<"{\"record_index\":"<<t.recordIndex
           <<",\"x\":"<<t.x<<",\"y\":"<<t.y<<",\"z\":"<<t.z
           <<",\"parts\":[";
        for(std::size_t part=0;part<t.parts.size();++part) {
            if(part)out<<',';
            const auto id=t.parts[part];
            out<<"{\"kind\":";
            escaped(out,kParts[part]);
            out<<",\"source_index\":"<<unsigned(id)
               <<",\"present\":"<<(id!=0?"true":"false");
            if(id!=0) {
                const auto r=resolveRecord(facts.datasets,id);
                out<<",\"dataset\":";
                escaped(out,facts.datasets[r.setIndex].id);
                out<<",\"local_index\":"<<r.localIndex;
            }
            out<<'}';
        }
        out<<"]}";
    }
    out<<"]},\"datasets\":[";
    for(std::size_t s=0;s<facts.datasets.size();++s) {
        if(s)out<<',';
        const DataSet& set=facts.datasets[s];
        out<<"{\"id\":";
        escaped(out,set.id);
        const std::size_t count=set.bytes.size()/kMcdBytes;
        out<<",\"record_count\":"<<count<<",\"records\":[";
        for(std::size_t j=0;j<count;++j) {
            if(j)out<<',';
            const auto* r=set.bytes.data()+j*kMcdBytes;
            out<<"{\"index\":"<<j<<",\"raw_hex\":";
            escaped(out,hexValue(r,kMcdBytes));
            out<<",\"frame\":";
            array(out,r,8);
            out<<",\"loft\":";
            array(out,r+8,12);
            out<<",\"scan_g\":"<<(unsigned(r[20])+(unsigned(r[21])<<8))
               <<",\"ufo_door\":"<<unsigned(r[30])
               <<",\"stop_los\":"<<unsigned(r[31])
               <<",\"no_floor\":"<<unsigned(r[32])
               <<",\"big_wall\":"<<unsigned(r[33])
               <<",\"gravlift\":"<<unsigned(r[34])
               <<",\"door\":"<<unsigned(r[35])
               <<",\"block_fire\":"<<unsigned(r[36])
               <<",\"block_smoke\":"<<unsigned(r[37])
               <<",\"tu_walk\":"<<unsigned(r[39])
               <<",\"tu_slide\":"<<unsigned(r[40])
               <<",\"tu_fly\":"<<unsigned(r[41])
               <<",\"armor\":"<<unsigned(r[42])
               <<",\"he_block\":"<<unsigned(r[43])
               <<",\"die_mcd\":"<<unsigned(r[44])
               <<",\"flammable\":"<<unsigned(r[45])
               <<",\"alt_mcd\":"<<unsigned(r[46])
               <<",\"terrain_level\":"<<signedByte(r[48])
               <<",\"p_level\":"<<unsigned(r[49])
               <<",\"light_block\":"<<unsigned(r[51])
               <<",\"footstep\":"<<unsigned(r[52])
               <<",\"tile_type\":"<<unsigned(r[53])
               <<",\"he_type\":"<<unsigned(r[54])
               <<",\"he_strength\":"<<unsigned(r[55])
               <<",\"smoke_blockage\":"<<unsigned(r[56])
               <<",\"fuel\":"<<unsigned(r[57])
               <<",\"light_source\":"<<unsigned(r[58])
               <<",\"target_type\":"<<unsigned(r[59])
               <<",\"xcom_base\":"<<unsigned(r[60])<<"}";
        }
        out<<"]}";
    }
    out<<"]}\n";
    return out.str();
}
} // namespace r02
