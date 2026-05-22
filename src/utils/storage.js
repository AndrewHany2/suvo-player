import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage works on both native (native storage) and web (localStorage shim).
// Use it everywhere instead of platform-branching.
export default AsyncStorage;
