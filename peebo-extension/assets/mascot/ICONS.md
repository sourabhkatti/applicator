# Peebo Icon Generation Guide

## Required Icon Sizes

The Chrome extension requires PNG icons in these sizes:
- `peebo-icon-16.png` (16x16) - Toolbar small
- `peebo-icon-32.png` (32x32) - Toolbar
- `peebo-icon-48.png` (48x48) - Extension management
- `peebo-icon-128.png` (128x128) - Chrome Web Store

---

## Text-to-Image Prompts

Use these detailed prompts with AI image generators (Midjourney, DALL-E, Stable Diffusion, etc.) to create consistent Peebo mascot icons.

### Base Character Description

**Peebo is a small, round, blob-shaped bird character with these defining features:**

- **Body shape**: Round, chubby, blob-like body (like a simplified sparrow or finch). The body is wider than it is tall, with a slight oval/egg shape.
- **Color**: Bright golden yellow (#FFD93D) as the primary color, with a lighter cream/pale yellow belly (#FFF3C4)
- **Eyes**: Large, friendly, circular eyes with white sclera and dark brown/black pupils. Eyes are positioned in the upper third of the body, spaced apart to look cute and approachable. Small white highlight dots in each eye.
- **Beak**: Small, triangular orange beak (#FF8A65) pointing downward, positioned between and below the eyes
- **Wings**: Small, stubby wings on each side of the body, slightly darker yellow/gold (#FFCC00)
- **Feet**: Simple orange stick feet with three toes each
- **Head tuft**: 2-3 small feather tufts sticking up from the top of the head, same gold color as wings
- **Expression**: Happy, friendly, approachable - like a helpful assistant
- **Style**: Flat design, minimal shading, clean vector-style illustration suitable for app icons

### Prompt for Main Icon (Idle State)

```
A cute, round, blob-shaped yellow bird mascot icon for a Chrome extension.
The bird has a chubby golden-yellow body (#FFD93D), cream-colored belly,
large friendly circular eyes with white backgrounds and dark pupils,
a small orange triangular beak, tiny stubby wings, and simple orange stick feet.
2-3 small feather tufts on top of head.
Happy, welcoming expression.
Flat design, vector illustration style, clean lines, minimal shading.
Solid light cream background (#FFF8E7) or transparent background.
Centered composition, facing forward.
App icon style, suitable for small sizes.
```

### Simplified Prompt (For 16x16 and 32x32)

At very small sizes, detail is lost. Use this simplified version:

```
Minimalist round yellow bird icon.
Simple blob shape, golden yellow (#FFD93D).
Two dots for eyes, small orange triangle beak.
Flat design, no outlines, app icon style.
Transparent or cream background.
Must be recognizable at 16x16 pixels.
```

### Style Keywords to Include

Add these to your prompts for consistent results:

- `flat design`
- `vector illustration`
- `app icon`
- `mascot character`
- `kawaii style` (optional, for cuter look)
- `minimalist`
- `clean lines`
- `no gradients` or `subtle gradients only`
- `centered composition`
- `transparent background` or `solid color background`

### Color Palette Reference

| Element | Color Name | Hex Code | RGB |
|---------|------------|----------|-----|
| Body | Peebo Yellow | #FFD93D | 255, 217, 61 |
| Belly | Soft Yellow | #FFF3C4 | 255, 243, 196 |
| Wings/Tuft | Gold | #FFCC00 | 255, 204, 0 |
| Beak/Feet | Coral Orange | #FF8A65 | 255, 138, 101 |
| Eyes (pupil) | Warm Charcoal | #3D3428 | 61, 52, 40 |
| Eyes (white) | White | #FFFFFF | 255, 255, 255 |
| Background | Cream | #FFF8E7 | 255, 248, 231 |

---

## Visual Reference

The existing SVG files in this directory serve as the definitive reference:

- `peebo-idle.svg` - **Use this as the primary reference for icons**
- `peebo-working.svg` - Active/busy state (not needed for icons)
- `peebo-success.svg` - Celebration state (not needed for icons)
- `peebo-error.svg` - Worried state (not needed for icons)
- `peebo-sleeping.svg` - Sleeping state (not needed for icons)

Open `peebo-idle.svg` in a browser or image viewer to see exactly what Peebo looks like.

---

## Size-Specific Guidelines

### 128x128 (Chrome Web Store)
- Full detail version
- Show all features: eyes with highlights, beak, wings, feet, head tuft
- Can include subtle shading
- This is the "hero" icon users see when installing

### 48x48 (Extension Management)
- Slightly simplified
- All features visible but less detail
- Eyes, beak, basic body shape, head tuft
- Feet can be simplified or omitted

### 32x32 (Toolbar)
- Simplified version
- Focus on recognizable silhouette
- Eyes and beak clearly visible
- Wings and feet can be suggested or omitted
- Head tuft simplified to 1-2 lines

### 16x16 (Toolbar Small)
- Highly simplified
- Must be recognizable as a yellow bird at a glance
- Round yellow shape with two eye dots and beak triangle
- No feet, minimal or no head tuft
- Think "emoji-level" simplification

---

## Export Settings

When saving generated images:

1. **Format**: PNG with transparency (if supported) or PNG-24
2. **Background**: Transparent preferred, or solid cream (#FFF8E7)
3. **Resolution**: Exact pixel dimensions (16x16, 32x32, 48x48, 128x128)
4. **Color profile**: sRGB
5. **Compression**: None or lossless

---

## Alternative: Convert from SVG

If you prefer to convert the existing SVG to PNG:

### Using Inkscape (CLI)
```bash
for size in 16 32 48 128; do
  inkscape -w $size -h $size peebo-idle.svg -o peebo-icon-$size.png
done
```

### Using ImageMagick
```bash
for size in 16 32 48 128; do
  convert -background none -resize ${size}x${size} peebo-idle.svg peebo-icon-$size.png
done
```

### Using rsvg-convert (librsvg)
```bash
for size in 16 32 48 128; do
  rsvg-convert -w $size -h $size peebo-idle.svg > peebo-icon-$size.png
done
```

### Online Tools
- [SVG to PNG Converter](https://svgtopng.com/)
- [CloudConvert](https://cloudconvert.com/svg-to-png)
- Figma (import SVG, export as PNG at various sizes)

---

## Checklist

- [ ] `peebo-icon-16.png` generated and saved
- [ ] `peebo-icon-32.png` generated and saved
- [ ] `peebo-icon-48.png` generated and saved
- [ ] `peebo-icon-128.png` generated and saved
- [ ] All icons tested in Chrome extension (load unpacked and verify toolbar display)
- [ ] Icons look good on both light and dark browser themes
