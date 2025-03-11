export interface Experiment {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  path: string;
  githubUrl: string;
}

export const experiments: Experiment[] = [
  {
    id: "calendar-stories",
    title: "Calendar Stories",
    description:
      "An interactive 3D calendar that reveals interesting facts and stories for each day.",
    thumbnail: "/thumbnails/calendar-stories.jpg",
    path: "/experiments/calendar-stories",
    githubUrl: "https://github.com/yourusername/calendar-stories",
  },
  // Add more experiments here as you create them
];
