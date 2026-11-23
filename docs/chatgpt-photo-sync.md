# Send recipe photos from ChatGPT to Homemade by Bekah

Bekah can add photos in the app (open a recipe, **Add Photos**), or send a photo to ChatGPT in the **Bekah Baking** project and say what to do with it. Both land in the same photo library for the recipe.

## What Bekah says

- "Make this the main photo for my chocolate chip cookie recipe."
- "Add these three pictures to the cinnamon roll gallery."
- "Add this photo to the recipe, but don't make it the main one."
- "Replace the main photo for S'mores Cookies."

Paste this prompt into the Bekah Baking project (together with the recipe prompt from `docs/chatgpt-recipe-sync.md`):

> When I send a photo and ask to add it to a recipe in Homemade by Bekah, read `docs/chatgpt-photo-sync.md` and `photo-imports/examples/photo.json` on `main` in `balexander012/Homemade-by-Bekah`. Use Python on the photo I attached: run the preparation script from the guide, which makes a JPEG no larger than 1600 pixels, computes its SHA-256, and splits the base64 text into parts. Then commit the manifest and every part, exactly as printed and unchanged, to `photo-imports/pending/` on `main`. Use the recipe key of the recipe I named; if more than one recipe could match, ask me. Set `setAsPrimary` to true only when I say it should be the main photo, and use `"mode": "replacePrimary"` only when I say to replace the main photo. Never draw, generate, edit or enhance the photo. If you cannot read the photo's bytes or cannot commit the files, tell me it was not saved. Afterwards, tell me whether the Baking inbox run says "Photo added"; if you can't read the run, say processing is pending.

## How the transfer works

The GitHub tools in ChatGPT write text files, so the photo travels as base64 text:

1. ChatGPT opens the attached photo in Python, keeps its real orientation, resizes it to at most 1600 pixels on the long edge, and saves it as JPEG (quality 82).
2. Python computes the SHA-256 of those JPEG bytes and splits the base64 text into parts of at most 20,000 characters.
3. ChatGPT commits `photo-imports/pending/<importId>.json` (the manifest) and `photo-imports/pending/<importId>.part-01.txt`, `.part-02.txt`, … on `main`. A very small image may instead go in `image.data` inside the manifest.
4. The **Baking inbox** workflow runs the reviewed importer. It joins the parts, checks the SHA-256 (so a part that was cut short or changed while copying is rejected, never saved), checks the real file type from its bytes, limits the image to 10 MB and 40 megapixels, applies the photo's orientation, removes metadata, and makes three WebP files: the photo (up to 2048 px), the 16:9 recipe card (1920 × 1080, cropped around the most detailed area, or around `crop`), and a 640 × 360 thumbnail.
5. The importer attaches the photo to the existing recipe in the database. The next time the app is opened on a signed-in device it shows the photo and moves the files into private Supabase Storage.

The transfer depends on ChatGPT copying the printed text exactly. A 1600-pixel JPEG is usually 6 to 15 parts. If a run says the data does not match `image.sha256`, the copy was incomplete: submit again with a new import ID, or add the photo in the app instead. ChatGPT cannot upload files to Supabase directly, and a link to an image is not accepted.

### Preparation script for ChatGPT

```python
import base64, hashlib, io, json, uuid
from PIL import Image, ImageOps

SOURCE = "/mnt/data/PHOTO_FILE_NAME"      # the photo Bekah attached
RECIPE_KEY = "jumbo-chocolate-chip-cookies"
RECIPE_NAME = "Bekah's Jumbo Chocolate Chip Cookies"
SET_AS_PRIMARY = True                      # False: add to the gallery only
MODE = "add"                               # "replacePrimary" only when asked to replace the main photo
CAPTION = ""

img = ImageOps.exif_transpose(Image.open(SOURCE)).convert("RGB")
img.thumbnail((1600, 1600))
buffer = io.BytesIO()
img.save(buffer, "JPEG", quality=82, optimize=True)
data = buffer.getvalue()
text = base64.b64encode(data).decode()
parts = [text[i:i + 20000] for i in range(0, len(text), 20000)]
import_id = str(uuid.uuid4())
manifest = {
    "schemaVersion": 1, "kind": "photo", "importId": import_id,
    "recipeKey": RECIPE_KEY, "recipeName": RECIPE_NAME,
    "setAsPrimary": SET_AS_PRIMARY, "mode": MODE, "caption": CAPTION,
    "filename": SOURCE.rsplit("/", 1)[-1],
    "image": {"contentType": "image/jpeg", "sha256": hashlib.sha256(data).hexdigest(), "parts": len(parts)},
}
print(f"photo-imports/pending/{import_id}.json")
print(json.dumps(manifest, indent=2))
for n, part in enumerate(parts, 1):
    print(f"\n===== photo-imports/pending/{import_id}.part-{n:02d}.txt =====")
    print(part)
```

HEIC photos from an iPhone open in Python only when `pillow-heif` is available. If Python can't open the photo, ask Bekah to send it as JPEG, or add it in the app, where Safari handles HEIC.

## Manifest fields

| Field | Use |
| --- | --- |
| `schemaVersion` | `1` |
| `kind` | `"photo"` |
| `importId` | A new lowercase UUID per photo. The manifest file is `<importId>.json`. Reuse it only to retry the identical photo. |
| `recipeKey` | The recipe's stable key, such as `jumbo-chocolate-chip-cookies`, `smores-cookies`, `homemade-cinnamon-rolls`. |
| `existingRecipeId` | Optional confirmed recipe UUID from an earlier import or lookup. Use it when a name is ambiguous. |
| `recipeName` | Optional exact recipe name. Also used to find the recipe. |
| `setAsPrimary` | `true` makes this the main photo; the previous main photo stays in the gallery. Default `false`. |
| `mode` | `"add"` (default) or `"replacePrimary"`: this becomes the main photo and the previous main photo is removed. |
| `caption`, `filename` | Optional, up to 300 and 255 characters. |
| `crop` | Optional `{ "x": 0.5, "y": 0.4, "zoom": 1 }`: the point to keep centered in the 16:9 card, as fractions of the upright photo. |
| `image.contentType` | `image/jpeg`, `image/png` or `image/webp` (`image/heic` is accepted but may not decode on the runner). |
| `image.sha256` | Lowercase hex SHA-256 of the image bytes before base64. Required. |
| `image.parts` or `image.data` | The number of `.part-NN.txt` files, or the whole base64 text inline. Exactly one. |

## Recipe matching, duplicates and retries

- The importer looks for the recipe by `existingRecipeId`, then the recipe key, then the exact `recipeName`, only inside the Homemade by Bekah workspace. It never creates a recipe. No match fails with **No matching recipe**; more than one match fails with **More than one recipe matches**, and ChatGPT should ask which recipe.
- Photos belong to the recipe, not to one version, so new recipe versions keep their photos and adding photos never creates a revision.
- The same picture is stored once per recipe (checked by SHA-256). Sending it again reports **Photo already in the gallery**; with `setAsPrimary` it just becomes the main photo again.
- Re-running the workflow answers earlier imports from their receipt (**(replayed)**) without adding anything. Reusing an import ID for a different photo fails.
- Nothing is overwritten unless `mode` is `replacePrimary`.

## Checking the result

- GitHub: **Actions → Baking inbox → latest run → Summary → Photo inbox**. Each import shows **Photo added**, **Photo already in the gallery**, or the reason it was rejected (bad hash, not an image, too large, missing part, no matching recipe).
- App: open the recipe. The main photo shows on the recipe card, at the top of the recipe, in Start baking and in the baking session.
- Supabase: `public.recipe_photos` has one row per photo (`source = 'chatgpt'`). `state` is `staged` until a signed-in device has moved the files into the private `baking-photos` bucket under `<workspace>/recipes/<recipe>/`, then `stored`.

The import files can stay in `photo-imports/pending/`; later runs skip them using their receipts. To tidy up, delete a photo's manifest and parts after its run says **Photo added**.

## Security

- The importer runs the pinned, reviewed commit with the existing restricted `baking_recipe_runner` database login. It can only call the recipe and photo inbox functions; it has no Storage, Supabase key or GitHub write access.
- Files are only accepted from the repository. The importer never downloads from a URL.
- In the app, photos are private to members of the workspace. Integration (OAuth) tokens can view but not change photos.
