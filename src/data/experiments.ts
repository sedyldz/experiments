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
  {
    id: "hand-push",
    title: "Hand Push",
    description:
      "A projection-mapping sketch where real hand tracking pushes floating objects out of the way, and they spring back to their resting spots once your hand is gone.",
    thumbnail: "/thumbnails/hand-push.jpg",
    path: "/experiments/hand-push",
    githubUrl: "https://github.com/yourusername/hand-push",
  },
  {
    id: "pixel-world",
    title: "tio.ist Pixel World",
    description:
      "An isometric, pixel-art dollhouse diorama of the tio.ist coworking space in Kadıköy, rendered through a low-res pixel pipeline with outlines, dithering and a hand-tuned palette.",
    thumbnail: "/thumbnails/pixel-world.jpg",
    path: "/experiments/pixel-world",
    githubUrl: "https://github.com/sedyldz/experiments",
  },
  // Add more experiments here as you create them
];
