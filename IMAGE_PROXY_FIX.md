# Image Loading Fix for TV Platforms

## Problem

Images were working in Electron but not on TV (webOS) due to:

1. **CORS restrictions** - TV platforms enforce strict Cross-Origin Resource Sharing policies
2. **Web security** - Electron has `webSecurity: false`, but TV platforms don't allow this
3. **HTTP/HTTPS mixed content** - TV apps may block HTTP images
4. **Missing headers** - Electron injects custom headers (User-Agent, Referer) that help bypass restrictions

## Solution Implemented

### 1. Updated TV Manifest (`tv/packaging/lg/appinfo.json`)

Added required permissions:

```json
"requiredPermissions": [
  "internet",
  "network.state"
],
"allowCrossDomain": true
```

### 2. Created Image Proxy Utility (`src/utils/imageProxy.js`)

- Detects TV platform automatically
- Routes images through CORS proxy services
- Provides fallback mechanisms
- Includes retry logic with alternative proxies

Key features:

- `getProxiedImageUrl()` - Converts URLs to use CORS proxy on TV
- `isTVPlatform()` - Detects webOS/SmartTV platforms
- `getBestImageUrl()` - Tests URLs and finds working proxy
- Automatic proxy rotation on failure

### 3. Created ProxiedImage Component (`src/components/ProxiedImage.jsx`)

A drop-in replacement for React Native's `Image` component:

- Automatically uses proxy on TV platforms
- Shows placeholder (🎬) when images fail to load
- Implements retry logic with alternative proxies
- Handles errors gracefully

### 4. Updated All Image Components

Replaced `Image` with `ProxiedImage` in:

- ✅ `src/screens/MoviesScreen.web.jsx` - Movie posters
- ✅ `src/components/MovieDetail.web.jsx` - Movie backdrops
- ✅ `src/screens/SeriesScreen.web.jsx` - Series posters
- ✅ `src/components/SeriesDetail.web.jsx` - Series backdrops
- ✅ `src/screens/LiveTVScreen.web.jsx` - Channel logos

## How It Works

### On TV Platforms (webOS):

1. Image URL is detected as external HTTP/HTTPS
2. URL is automatically routed through CORS proxy
3. Proxy fetches the image and serves it with proper CORS headers
4. If primary proxy fails, automatically tries alternative proxy
5. If all proxies fail, shows placeholder icon

### On Electron/Desktop:

1. Images load directly (no proxy needed)
2. Electron's `webSecurity: false` allows direct loading
3. Custom headers help bypass server restrictions

## CORS Proxy Services Used

Currently using free public proxies (replace with your own in production):

1. `https://corsproxy.io/?`
2. `https://api.allorigins.win/raw?url=`

**For production**, consider:

- Setting up your own CORS proxy server
- Using a CDN with CORS support
- Caching images on your backend

## Testing on TV

### 1. Build for TV:

```bash
npm run build
```

### 2. Package for webOS:

```bash
# Package the app
cd tv/packaging/lg
ares-package ../../../dist -o ./
```

### 3. Install on TV:

```bash
# Install on connected TV
ares-install --device YOUR_TV_NAME com.andrew1h1.iptvplayer_1.0.0_all.ipk
```

### 4. Launch and Test:

```bash
# Launch the app
ares-launch --device YOUR_TV_NAME com.andrew1h1.iptvplayer
```

### 5. Check Logs:

```bash
# View logs for debugging
ares-inspect --device YOUR_TV_NAME --app com.andrew1h1.iptvplayer
```

## Verification Checklist

- [ ] Movie posters load on TV
- [ ] Movie detail backdrops load on TV
- [ ] Series posters load on TV
- [ ] Series detail backdrops load on TV
- [ ] Live TV channel logos load on TV
- [ ] Placeholder shows when images fail
- [ ] Images still work in Electron
- [ ] No console errors related to CORS

## Troubleshooting

### Images still not loading?

1. Check TV internet connection
2. Verify CORS proxy services are accessible
3. Check browser console for errors (use `ares-inspect`)
4. Try alternative IPTV server with HTTPS images

### Slow image loading?

1. CORS proxies add latency (normal)
2. Consider implementing image caching
3. Use your own proxy server for better performance

### Placeholder showing instead of images?

1. Check if original image URL is valid
2. Test URL in browser with CORS proxy manually
3. Verify TV has internet access
4. Check if IPTV server is blocking requests

## Future Improvements

1. **Image Caching**: Cache proxied images locally
2. **Custom Proxy**: Deploy your own CORS proxy server
3. **Progressive Loading**: Show low-res placeholder while loading
4. **Lazy Loading**: Only load images when visible
5. **CDN Integration**: Use CDN with CORS support

## Notes

- The proxy adds ~200-500ms latency per image
- Free proxies have rate limits (use your own for production)
- Images are not cached by default (implement caching for better UX)
- Electron builds are unaffected (no proxy used)
