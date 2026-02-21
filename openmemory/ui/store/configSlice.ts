import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/** LLM and embedder are configured exclusively via environment variables. */
export interface Mem0Config {
  vector_store?: Record<string, any> | null;
}

export interface OpenMemoryConfig {
  custom_instructions?: string | null;
}

export interface ConfigState {
  openmemory: OpenMemoryConfig;
  mem0: Mem0Config;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | null;
}

const initialState: ConfigState = {
  openmemory: {
    custom_instructions: null,
  },
  mem0: {
    vector_store: null,
  },
  status: 'idle',
  error: null,
};

const configSlice = createSlice({
  name: 'config',
  initialState,
  reducers: {
    setConfigLoading: (state) => {
      state.status = 'loading';
      state.error = null;
    },
    setConfigSuccess: (state, action: PayloadAction<{ openmemory?: OpenMemoryConfig; mem0: Mem0Config }>) => {
      if (action.payload.openmemory) {
        state.openmemory = action.payload.openmemory;
      }
      state.mem0 = action.payload.mem0;
      state.status = 'succeeded';
      state.error = null;
    },
    setConfigError: (state, action: PayloadAction<string>) => {
      state.status = 'failed';
      state.error = action.payload;
    },
    updateOpenMemory: (state, action: PayloadAction<OpenMemoryConfig>) => {
      state.openmemory = action.payload;
    },
    updateMem0Config: (state, action: PayloadAction<Mem0Config>) => {
      state.mem0 = action.payload;
    },
  },
});

export const {
  setConfigLoading,
  setConfigSuccess,
  setConfigError,
  updateOpenMemory,
  updateMem0Config,
} = configSlice.actions;

export default configSlice.reducer; 