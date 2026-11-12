// Polyfills must load before anything that touches crypto.
import './src/polyfills';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
