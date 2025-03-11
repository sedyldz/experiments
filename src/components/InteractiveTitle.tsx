import React, { useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";

interface CubeFaceProps {
  position: THREE.Vector3;
  text: string;
  onClick: () => void;
}

const CubeFace: React.FC<CubeFaceProps> = ({ position, text, onClick }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const targetRotation = useRef(0);
  const currentRotation = useRef(0);

  useFrame(() => {
    if (!meshRef.current) return;
    currentRotation.current +=
      (targetRotation.current - currentRotation.current) * 0.1;
    meshRef.current.rotation.y = currentRotation.current;
  });

  const handleClick = () => {
    targetRotation.current += Math.PI / 2;
    onClick();
  };

  return (
    <mesh ref={meshRef} position={position} onClick={handleClick}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#0066ff" />
      <Text
        position={[0, 0, 0.51]}
        fontSize={0.5}
        color="white"
        anchorX="center"
        anchorY="middle"
      >
        {text}
      </Text>
    </mesh>
  );
};

const InteractiveTitle: React.FC = () => {
  const title = "EXPERIMENTS";

  return (
    <div className="w-full h-[50vh] bg-gray-900">
      <Canvas camera={{ position: [0, 0, 10], fov: 50 }} dpr={[1, 2]}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <group position={[-4, 0, 0]}>
          {title.split("").map((letter, i) => (
            <CubeFace
              key={i}
              position={new THREE.Vector3(i * 1.2, 0, 0)}
              text={letter}
              onClick={() => {
                console.log(`Clicked letter: ${letter}`);
              }}
            />
          ))}
        </group>
      </Canvas>
    </div>
  );
};

export default InteractiveTitle;
