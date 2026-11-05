// Entry point. The background location task must be defined at module scope before the app
// renders so the OS can deliver location events to it even when the UI is not mounted.
import './src/recording/task';
import 'expo-router/entry';
