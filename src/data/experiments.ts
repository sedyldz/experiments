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
  {
    id: "camera-portal",
    title: "Camera Portal",
    description:
      "A motion-reactive projection-mapping sketch: a webcam detects movement in front of it and renders it live as glowing trails and particles inside a portal, ready to project onto a wall or floor.",
    thumbnail: "/thumbnails/camera-portal.jpg",
    path: "/experiments/camera-portal",
    githubUrl: "https://github.com/yourusername/camera-portal",
  },
  // Add more experiments here as you create them
];
