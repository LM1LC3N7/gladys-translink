# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.0] - 2026-10-11

### Added

- First version, derived from gladys-stm (STM Montréal).
- Next departures of every TransLink stop (bus, SkyTrain, SeaBus, West Coast
  Express): from Transitous without any account (timetable, and real time
  where Transitous has it), from the TransLink GTFS-Realtime feed with a free
  key.
- Status of the Expo, Millennium and Canada lines, the SeaBus and the West
  Coast Express, from the TransLink service alerts (with a key).
- Mobi stations: bikes, e-bikes and free docks.
- The closest stops and Mobi stations suggested from the house location; a
  SkyTrain station is offered once for all its platforms.
- Stop search by name or number, in the stop list shipped with the image.
- Dashboard widgets, scene triggers and scene actions (Gladys 5.1.0+).

[Unreleased]: https://github.com/LM1LC3N7/gladys-translink/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LM1LC3N7/gladys-translink/releases/tag/v0.1.0
