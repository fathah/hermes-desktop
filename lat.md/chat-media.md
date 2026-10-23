# Chat media

Chat media tokens preserve source URLs while classifying image previews and deriving download names from their paths.

## URL image classification

HTTP image URLs remain previews when they contain signed query parameters or fragments. A non-image path does not become an image because its query mentions an image filename.

[[src/renderer/src/screens/Chat/mediaUtils.ts#toToken]] uses the URL pathname for image extensions and names while retaining the original source for fetching. Root URLs without a filename use their hostname as the suggested name. Local filenames keep literal question marks and hashes.

[[src/renderer/src/screens/Chat/mediaUtils.test.ts]] covers explicit MEDIA tokens, Markdown images, direct image descriptions, non-image URL controls, and local filename controls.
