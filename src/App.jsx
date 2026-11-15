import React, { useEffect } from 'react';
import { MarsProvider, useMars } from './context/MarsContext.jsx';
import { Loader } from './components/Loader.jsx';
import { LandingScreen } from './components/LandingScreen.jsx';
import { Navbar } from './components/Navbar.jsx';
import { SysBar } from './components/SysBar.jsx';
import { LayersPanel } from './components/LayersPanel.jsx';
import { StatsBar } from './components/StatsBar.jsx';
import { ContextPanel } from './components/ContextPanel.jsx';
import { TimelineToolbar } from './components/TimelineToolbar.jsx';
import { TargetModal } from './components/TargetModal.jsx';
import { RoverModal } from './components/RoverModal.jsx';
import { HudOverlay } from './components/HudOverlay.jsx';
import { AiModal } from './components/AiModal.jsx';
import { CompleteModal } from './components/CompleteModal.jsx';
import { AlertBanner } from './components/AlertBanner.jsx';
import { SimResultBanner } from './components/SimResultBanner.jsx';
import { ScanOverlay } from './components/ScanOverlay.jsx';
import { FlashTransition } from './components/FlashTransition.jsx';
import { DemoCaption } from './components/DemoCaption.jsx';
import { LabelsOverlay } from './components/LabelsOverlay.jsx';
import { TerrainProbe } from './components/TerrainProbe.jsx';

const MarsApp = () => {
  const mars = useMars();
  const { canvasRef, fxHigh, tabletMode, hudActive, mode } = mars;

  // Sync window.__marsx for external control / tests
  useEffect(() => {
    window.__marsx = {
      ...mars,
      state: {
        mode: mars.mode,
        panel: mars.panel,
        layers: mars.layers,
        included: mars.included,
        selTarget: mars.selTarget,
        routes: mars.routes,
        rec: mars.recRoute,
        cons: mars.cons,
        hud: mars.hudActive,
        surface: mars.surfaceActive,
        eva: mars.evaActive,
        demo: mars.demoActive,
        fx: mars.fxHigh
      },
      store: mars.storeRef.current,
      engine: () => mars.engineRef.current,
      planEVA: mars.planEVA,
      triggerEvent: mars.triggerEvent,
      flyToGale: mars.flyToGale,
      selectRegion: mars.selectRegion,
      descendToRegion: mars.descendToRegion,
      enterMissionControl: mars.enterMissionControl,
      selectTarget: mars.selectTarget,
      setLayer: mars.toggleLayer,
      startEVA: mars.startEVA,
      stopEVA: mars.stopEVA,
      enterSurface: mars.enterSurface,
      exitSurface: mars.exitSurface,
      toggleHUD: mars.toggleHUD,
      runDemo: mars.runDemo
    };
  }, [mars]);

  // Sync body classes
  useEffect(() => {
    document.body.classList.toggle('tablet', !!tabletMode);
    document.body.classList.toggle('hudon', !!hudActive);
    document.body.classList.toggle('reduced', !fxHigh);
  }, [tabletMode, hudActive, fxHigh]);

  return (
    <>
      <canvas id="gl" ref={canvasRef} />
      <div className="fx-vig" />
      <div
        className="fx-scan"
        id="fxscan"
        style={{ display: fxHigh ? '' : 'none' }}
      />

      <LabelsOverlay />
      <Loader />
      <LandingScreen />
      <Navbar />
      <SysBar />
      <LayersPanel />
      <StatsBar />
      <ContextPanel />
      <TimelineToolbar />
      <TargetModal />
      <RoverModal />
      <HudOverlay />
      <AiModal />
      <CompleteModal />
      <AlertBanner />
      <SimResultBanner />
      <ScanOverlay />
      <FlashTransition />
      <DemoCaption />
      <TerrainProbe />
    </>
  );
};

export default function App() {
  return (
    <MarsProvider>
      <MarsApp />
    </MarsProvider>
  );
}
