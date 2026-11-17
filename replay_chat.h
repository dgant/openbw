#ifndef BWGAME_REPLAY_CHAT_H
#define BWGAME_REPLAY_CHAT_H

namespace bwgame {

// Presentation state belongs to action snapshots, never to wall-clock timers.
// Keeping the last eleven messages is sufficient for the eleven native lines.
struct replay_chat_message {
	int frame = 0;
	int sender = -1;
	a_string text;
};

constexpr int replay_chat_lifetime_frames = (7000 + 41) / 42;
constexpr size_t replay_chat_max_lines = 11;

template<typename messages_T, typename reader_T>
bool read_replay_chat(messages_T& messages, int frame, reader_T&& r) {
	// The first byte is the sender SLOT, not part of the 80-byte text field.
	int sender = r.template get<uint8_t>();
	auto bytes = r.template get<std::array<uint8_t, 80>>();
	a_string text;
	for (auto value : bytes) {
		if (!value) break;
		text += char(value); // Preserve native text/color control bytes.
	}
	if (text.empty()) return false;
	if (messages.size() == replay_chat_max_lines) messages.erase(messages.begin());
	messages.push_back(replay_chat_message{frame, sender, std::move(text)});
	return true;
}

inline bool replay_chat_visible(const replay_chat_message& message, int frame) {
	return frame >= message.frame && frame - message.frame < replay_chat_lifetime_frames;
}

}
#endif
