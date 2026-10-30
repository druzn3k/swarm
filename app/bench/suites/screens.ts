// The screens the tick and render suites visit.
export interface Screen {
  screen: string;
  route: string;
}

export const SCREENS: Screen[] = [
  { screen: "meat", route: "#/tab/meat" },
  { screen: "all units", route: "#/tab/all" },
  { screen: "drone", route: "#/unit/drone" },
  { screen: "energy", route: "#/tab/energy" },
  { screen: "mutagen", route: "#/tab/mutagen" },
  { screen: "achievements", route: "#/achievements" },
  { screen: "statistics", route: "#/statistics" },
  { screen: "options", route: "#/options" },
];
