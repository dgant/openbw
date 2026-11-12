#ifndef OPENBW_REMASTERED_REPLAY_H
#define OPENBW_REMASTERED_REPLAY_H

#include "data_loading.h"
#include <zlib.h>

namespace bwgame { namespace remastered_replay {

using bytes = a_vector<uint8_t>;
using reader = data_loading::data_reader_le;

struct sections {
	bytes header;
	bytes commands;
	bytes map;
	std::array<uint32_t, 7> limits{{5000, 2500, 0, 1700, 100, 2000, 0}};
};

inline bytes block(reader& input, size_t size) {
	// Remastered omits empty sections; legacy writers may include an empty frame.
	if (!size && (input.left() < 8 || data_loading::value_at<uint64_t, true>(input.ptr) != 0xffffffffu)) return {};
	if (size > 128 * 1024 * 1024) error("Replay section is too large");
	auto checksum = input.get<uint32_t>();
	if (input.get<uint32_t>() != (size + 8191) / 8192) error("Invalid replay chunk count");
	bytes result(size);
	for (size_t offset = 0; offset < size; offset += 8192) {
		size_t count = input.get<uint32_t>();
		size_t expected = std::min(size - offset, size_t(8192));
		if (count > size_t(input.end - input.ptr)) error("Truncated replay chunk");
		if (count == expected) {
			input.get_bytes(result.data() + offset, count);
			continue;
		}
		if (count >= 2 && input.ptr[0] == 0x78 && (256 * input.ptr[0] + input.ptr[1]) % 31 == 0) {
			uLongf length = expected;
			if (uncompress(result.data() + offset, &length, input.ptr, count) != Z_OK || length != expected)
				error("Invalid compressed replay chunk");
		} else {
			bytes compressed(input.ptr, input.ptr + count);
			data_loading::decompress(compressed.data(), count, result.data() + offset, expected);
		}
		input.ptr += count;
	}
	if (uint32_t(~::crc32(0, result.data(), result.size())) != checksum) error("Replay checksum mismatch");
	return result;
}

inline uint32_t number(reader& input) {
	auto value = block(input, 4);
	return data_loading::value_at<uint32_t, true>(value.data());
}

inline sections decode(const uint8_t* data, size_t size) {
	reader input(data, data + size);
	auto magic = number(input);
	if (magic != 0x53526572 && magic != 0x53526573) error("Invalid Remastered replay identifier");
	size_t metadata = magic == 0x53526573 ? input.get<uint32_t>() : 0;
	sections result;
	result.header = block(input, 633);
	result.commands = block(input, number(input));
	result.map = block(input, number(input));
	if (metadata) {
		if (metadata < size_t(input.ptr - data) || metadata > size) error("Invalid replay metadata offset");
		reader sections(data + metadata, data + size);
		while (sections.ptr != sections.end) {
			auto tag = sections.get<uint32_t>();
			size_t length = sections.get<uint32_t>();
			if (length > size_t(sections.end - sections.ptr)) error("Truncated replay metadata");
			if (tag == 0x53544d4c) { // LMTS
				reader field(sections.ptr, sections.ptr + length);
				auto limits = block(field, 28);
				reader values(limits.data(), limits.data() + limits.size());
				for (auto& value : result.limits) value = values.get<uint32_t>();
			}
			sections.ptr += length;
		}
	}
	return result;
}

} }
#endif
