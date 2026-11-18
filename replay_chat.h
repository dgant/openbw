#ifndef BWGAME_REPLAY_CHAT_H
#define BWGAME_REPLAY_CHAT_H

#include "data_loading.h"

namespace bwgame {

struct replay_chat {
	struct message {
		int frame;
		uint8_t sender;
		a_string text;
	};
	static constexpr unsigned lines = 11;
	static constexpr int lifetime = (7000 + 41) / 42;
	a_vector<message> recent;
	size_t received = 0;

	template<typename reader_T>
	bool receive(int frame, reader_T& reader) {
		auto sender = reader.template get<uint8_t>();
		auto field = reader.template get<std::array<char, 80>>();
		auto end = std::find(field.begin(), field.end(), '\0');
		if (end == field.begin()) return false;
		if (recent.size() == lines) recent.erase(recent.begin());
		recent.push_back({frame, sender, a_string(field.begin(), end)});
		++received;
		return true;
	}
};

}
#endif
