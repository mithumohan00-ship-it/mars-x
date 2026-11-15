# 🛰️ NASA Resources & Planetary Data Systems Integration

[![NASA Space Apps Challenge](https://img.shields.io/badge/NASA%20Space%20Apps-Challenge%20Project-FF4B4B?style=for-the-badge&logo=nasa&logoColor=white)](https://www.spaceappschallenge.org/)
[![NASA Open Data](https://img.shields.io/badge/NASA-Open%20Data-0B3D91?style=for-the-badge&logo=nasa&logoColor=white)](https://data.nasa.gov/)
[![PDS Integrated](https://img.shields.io/badge/NASA%20PDS-Integrated%20Datasets-00E5FF?style=for-the-badge)](https://pds.nasa.gov/)
[![USGS Astrogeology](https://img.shields.io/badge/USGS-Astrogeology%20GIS-327743?style=for-the-badge)](https://astrogeology.usgs.gov/)

> **This document provides a comprehensive audit of all NASA, USGS Astrogeology, and robotic planetary mission datasets, instruments, PDS nodes, and imagery feeds integrated into the MARS-X Human Marswalk Mission Planning Platform.**

---

## 📑 Table of Contents

1. [Executive Summary](#-executive-summary)
2. [NASA Planetary Data System (PDS) Nodes Utilized](#-nasa-planetary-data-system-pds-nodes-utilized)
3. [Missions, Instruments & Datasets](#-missions-instruments--datasets)
4. [Region-Specific PDS & HiRISE DTM Catalog](#-region-specific-pds--hirise-dtm-catalog)
5. [In-App Data Ingestion & Pipeline Architecture](#-in-app-data-ingestion--pipeline-architecture)
6. [Live Telemetry & Raw Image Feeds](#-live-telemetry--raw-image-feeds)
7. [References & Citations](#-references--citations)

---

## 🌟 Executive Summary

**MARS-X** synthesizes real planetary science data from active and historical NASA missions to simulate realistic, physically grounded Extravehicular Activity (EVA) traverses. Rather than utilizing generic game landscapes, each of the **six exploration sectors** in MARS-X corresponds directly to calibrated coordinates, digital elevation models, and radiometric datasets acquired by NASA orbiter and surface assets:

- **Orbital Topography & Slopes:** NASA MGS MOLA and MRO HiRISE Stereo Digital Terrain Models (DTMs).
- **Mineralogical Spectral Indices:** MRO CRISM hyperspectral targeted observations (phyllosilicates, hematite, hydrated sulfates).
- **Surface Thermal Inertia:** Mars Odyssey THEMIS infrared day/night mosaics.
- **In-Situ Environmental Conditions:** MSL Curiosity Rover Environmental Monitoring Station (REMS) and Radiation Assessment Detector (RAD).
- **Visual Ground Truth & Rover Telemetry:** Mars 2020 Perseverance Mastcam-Z and SuperCam Remote Micro-Imager (RMI) raw image archives.
- **Geologic Mapping:** USGS Astrogeology Science Center Unified Geologic Map of Mars (SIM 3292).

---

## 🏛️ NASA Planetary Data System (PDS) Nodes Utilized

MARS-X interfaces with data structures distributed across four primary NASA PDS nodes:

| PDS Node | Host Institution | Integrated Datasets | Access Link |
|---|---|---|---|
| **PDS Geosciences Node** | Washington University in St. Louis | MOLA MEGDR elevation grids, CRISM targeted spectral cubes, topographic maps | [pds-geosciences.wustl.edu](https://pds-geosciences.wustl.edu/) |
| **PDS Cartography & Imaging Sciences Node** | USGS Astrogeology / NASA JPL | HiRISE DTMs, CTX controlled mosaics, global image basemaps, Viking/THEMIS IR | [pds-imaging.jpl.nasa.gov](https://pds-imaging.jpl.nasa.gov/) |
| **PDS Atmospheres Node** | New Mexico State University | MSL REMS atmospheric observations, atmospheric pressure ($P$), dust optical depth ($\tau$) | [pds-atmospheres.nmsu.edu](https://pds-atmospheres.nmsu.edu/) |
| **PDS Planetary Plasma Interactions (PPI) Node** | University of California, Los Angeles | MSL RAD surface particle flux and human equivalent radiation dose rates | [pds-ppi.igpp.ucla.edu](https://pds-ppi.igpp.ucla.edu/) |

---

## 🔬 Missions, Instruments & Datasets

### 1. Mars Global Surveyor (MGS) — Mars Orbiter Laser Altimeter (MOLA)
- **Dataset:** MOLA Mission Experiment Gridded Data Record (MEGDR)
- **Product ID:** `MGS-M-MOLA-5-MEGDR-L3-V1.0`
- **Resolution:** 128 pixels/degree (~463 meters per pixel at the Martian equator)
- **Application in MARS-X:** 
  - Establishes the planetary datum (areoid / 0-meter elevation reference).
  - Drives the 3D interactive Mars orbital globe topography and regional elevation datums (e.g., Hellas Planitia $-7,150\text{ m}$, Olympus Mons $+1,200\text{ m}$ scarp base).
- **Resource URL:** [MOLA MEGDR Archive](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v10/mgsl_300x/)

### 2. Mars Reconnaissance Orbiter (MRO) — HiRISE
- **Dataset:** High Resolution Imaging Science Experiment Stereo Digital Terrain Models (DTMs)
- **Product ID:** `MRO-M-HIRISE-5-DTM-V1.0`
- **Resolution:** 1.0 m/pixel horizontal sampling, ~0.2 m vertical precision
- **Application in MARS-X:**
  - Micro-topography, surface roughness, cliff slope gradients, and obstacle avoidance grids for astronaut foot paths.
  - Generates the $257 \times 257$ heightfield grids used by the WebGL terrain mesh renderer and A* heuristic routing engine.
- **Resource URL:** [HiRISE DTM Catalog](https://www.uahirise.org/dtm/)

### 3. Mars Reconnaissance Orbiter (MRO) — CRISM
- **Dataset:** Compact Reconnaissance Imaging Spectrometer for Mars Targeted Empirical Data Records (EDR/CDR/MRDR)
- **Product ID:** `MRO-M-CRISM-3-RDR-TARGETED-V1.0`
- **Spectral Range:** 362 to 3920 nm across 544 spectral channels
- **Application in MARS-X:**
  - Calibrates the multi-spectral shader overlay in the MARS-X viewport.
  - Accurately highlights phyllosilicate (clay minerals at $2.2\ \mu\text{m}$ absorption band), crystalline hematite ($860\text{ nm}$ ferric band), and hydrated sulfates ($1.9\ \mu\text{m}$ and $2.4\ \mu\text{m}$).
- **Resource URL:** [CRISM PDS Geosciences Archive](https://pds-geosciences.wustl.edu/missions/mro/crism.htm)

### 4. Mars Reconnaissance Orbiter (MRO) — Context Camera (CTX)
- **Dataset:** CTX Controlled Panchromatic Image Mosaics
- **Product ID:** `MRO-M-CTX-2-EDR-L0-V1.0`
- **Resolution:** 5.0 to 6.0 m/pixel
- **Application in MARS-X:**
  - High-fidelity albedo basemap texturing, horizon backdrops, and regional crater boundary matching.
- **Resource URL:** [CTX Image Archive](https://pds-imaging.jpl.nasa.gov/volumes/mro.html)

### 5. 2001 Mars Odyssey — THEMIS
- **Dataset:** Thermal Emission Imaging System Daytime and Nighttime Infrared Global Mosaics
- **Product ID:** `ODY-M-THEMIS-5-IR-GLOBAL-V1.0`
- **Resolution:** 100 m/pixel
- **Application in MARS-X:**
  - Surface thermal inertia mapping: differentiates consolidated rock outcrops (slow thermal decay, safe footing) from fine, low-bearing-capacity dust deposits (rapid thermal decay, treacherous terrain).
- **Resource URL:** [THEMIS Mars Odyssey Portal](https://astrogeology.usgs.gov/search/map/Mars/Odyssey/THEMIS-IR-Day-Global-Mosaic)

### 6. MSL Curiosity — REMS & RAD Instruments
- **REMS (Rover Environmental Monitoring Station):**
  - **Product ID:** `MSL-M-REMS-4-RDR-V1.0`
  - Calibrates diurnal surface pressure ($7.2\text{ hPa}$ nominal), air/ground temperature shifts ($-48^\circ\text{C}$ to $-22^\circ\text{C}$), and wind patterns.
  - [REMS PDS Atmospheres Link](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html)
- **RAD (Radiation Assessment Detector):**
  - **Product ID:** `MSL-M-RAD-3-RDR-V1.0`
  - Informs the topological surface radiation exposure model ($0.64\text{ to }0.70\text{ mSv/day}$ dose rate) and astronaut cumulative exposure counters.
  - [RAD PDS PPI Node Link](https://pds-ppi.igpp.ucla.edu/mission/MSL/RAD)

### 7. Mars 2020 Perseverance — Mastcam-Z & SuperCam RMI
- **Dataset:** NASA Mars 2020 Raw Image Repository & Telemetry Feed
- **Resource URL:** [https://mars.nasa.gov/mars2020/multimedia/raw-images/](https://mars.nasa.gov/mars2020/multimedia/raw-images/)
- **Application in MARS-X:**
  - Real-time in-app linkage from Jezero Crater science targets directly to NASA's public raw image telemetry archive for verification of sample return targets.

### 8. USGS Astrogeology Science Center
- **Dataset:** Unified Geologic Map of Mars (USGS Scientific Investigations Map 3292)
- **Author/Citation:** Tanaka, K. L. et al. (2014)
- **Scale:** 1:20,000,000 global scale
- **Application in MARS-X:**
  - Stratigraphic classification: Bradbury Group, Murray Formation, sulfate units, and basaltic dune sands.
- **Resource URL:** [USGS Astrogeology Mars Interactive Maps](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars)

---

## 🗺️ Region-Specific PDS & HiRISE DTM Catalog

Each of the six exploration regions simulated in MARS-X is indexed to exact NASA orbital products:

| Exploration Region | Coordinates | Baseline Elevation | Primary HiRISE DTM Product | Primary CRISM Observation Cube |
|---|---|---|---|---|
| **Gale Crater (Mount Sharp NW)** | 5.4°S, 137.8°E | -4,450 m | `DTEEC_009187_1755_009899_1755` | `FRT0000B242` |
| **Jezero Crater (Western Delta)** | 18.4°N, 77.5°E | -2,500 m | `DTEEC_045994_1985_045361_1985` | `HRL000040FF` |
| **Olympus Mons (Basal Scarp)** | 18.6°N, 133.8°W | +1,200 m | `DTEEC_002824_1985_003536_1985` | `HRS0000A382` |
| **Valles Marineris (Candor Chasma)** | 14.0°S, 59.0°W | -3,800 m | `DTEEC_005527_1660_006094_1660` | `FRT0000958C` |
| **Hellas Planitia (South-Central Plain)** | 42.4°S, 70.5°E | -7,150 m | `DTEEC_037233_1375_037444_1375` | `FRT00003BD4` |
| **Elysium Planitia (Cerberus Fossae)** | 4.5°N, 135.6°E | -2,800 m | `DTEEC_007850_1850_008562_1850` | `FRT0000B33A` |

---

## ⚙️ In-App Data Ingestion & Pipeline Architecture

In MARS-X, planetary data flows through a structured ingestion and normalization architecture:

```
+-------------------------------------------------------------+
|                     NASA PDS / USGS DATA                    |
|  - HiRISE / MOLA DTMs (GeoTIFF / IMG)                       |
|  - CRISM Multi-spectral RDR Cubes                           |
|  - REMS Atmospheric / RAD Radiation Records                 |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                      DATA NORMALIZATION                     |
|  - src/engine/dataProvider.js                               |
|  - DataNormalizer: Convert planetary lat/lon to local ENU   |
|  - Coordinate conversion: 50 m/unit horizontal scale        |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                       GEOSPATIAL STORE                      |
|  - GeoStore: In-memory Float32 heightfield (257x257)        |
|  - Slope gradient field & normal vector computation         |
|  - Multi-spectral, thermal, and radiation attribute arrays  |
+-------------------------------------------------------------+
               |                               |
               v                               v
+-------------------------------+ +---------------------------+
|      ROUTE PLANNING ENGINE    | |     3D GRAPHICS ENGINE    |
| - A* multi-objective search   | | - WebGL custom shaders    |
| - Slope, hazard, dosimetric   | | - Three.js terrain mesh   |
|   cost matrix optimization    | | - Real-time contour lines |
+-------------------------------+ +---------------------------+
               |                               |
               +---------------+---------------+
                               |
                               v
+-------------------------------------------------------------+
|                REACT 19 MISSION CONTROL & HUD               |
|  - Astronaut first-person view, compass & telemetry         |
|  - Live distance, MET, hazard radar, and contingency alerts |
+-------------------------------------------------------------+
```

### Programmatic Access
The complete metadata catalog is also available programmatically inside the codebase:
- JSON Data File: [`src/data/nasaResources.json`](src/data/nasaResources.json)
- Static Endpoint: [`public/data/nasaResources.json`](public/data/nasaResources.json)
- Adapter Classes: [`src/engine/dataProvider.js`](src/engine/dataProvider.js) (`NasaPdsDataProvider`, `DataNormalizer`, `GeoStore`)

---

## 📡 Live Telemetry & Raw Image Feeds

MARS-X incorporates real-time hyperlinking and data interfaces to NASA's public multimedia archives:
1. **NASA Mars 2020 Raw Feed:** Direct links to Mastcam-Z, SuperCam, and Hazcam raw images for target inspection:
   [https://mars.nasa.gov/mars2020/multimedia/raw-images/](https://mars.nasa.gov/mars2020/multimedia/raw-images/)
2. **USGS Astrogeology Interactive Mars GIS:**
   [https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars)

---

## 📚 References & Citations

1. **Smith, D. E., et al. (2001).** Mars Orbiter Laser Altimeter: Experiment overview and selected results from the primary mission. *Journal of Geophysical Research: Planets*, 106(E10), 23689-23722.
2. **McEwen, A. S., et al. (2007).** Mars Reconnaissance Orbiter's High Resolution Imaging Science Experiment (HiRISE). *Journal of Geophysical Research: Planets*, 112(E5).
3. **Murchie, S., et al. (2007).** Compact Reconnaissance Imaging Spectrometer for Mars (CRISM) on Mars Reconnaissance Orbiter (MRO). *Journal of Geophysical Research: Planets*, 112(E5).
4. **Gómez-Elvira, J., et al. (2012).** REMS: The Environmental Sensor Suite for the Mars Science Laboratory/Curiosity. *Space Science Reviews*, 170(1-4), 583-640.
5. **Hassler, D. M., et al. (2014).** Mars' Surface Radiation Environment Measured with the Mars Science Laboratory's Curiosity Rover. *Science*, 343(6169), 1244797.
6. **Tanaka, K. L., et al. (2014).** Geologic map of Mars. *USGS Scientific Investigations Map 3292*, Pamphlet 43 p., 1 sheet.

---

<p align="center">
  <b>MARS-X</b> · Developed for the NASA Space Apps Challenge · Advancing Human Exploration of the Red Planet.
</p>
