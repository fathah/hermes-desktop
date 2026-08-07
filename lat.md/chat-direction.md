# Chat Direction

Chat text uses browser bidi detection so mixed RTL/LTR prompts and responses stay readable without forcing English-only content into RTL layout.

The composer textarea and the rendered chat bubble both set `dir="auto"`, letting the browser choose direction from the first strong character in the text. Agent code blocks keep explicit LTR styling so source code remains readable inside RTL-adjacent responses.
