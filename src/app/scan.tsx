import { useRef, useState } from 'react';
import { View, Text, Button, Image, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Scan() {
  const insets=useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  if (!permission) return <View />; // still loading permission state

  if (!permission.granted) {
    return ( 
      <View style={styles.center}>
        <Text style={styles.msg}>We need the camera to read your appliance sticker.</Text>
        <Button title="Allow camera" onPress={requestPermission} />
      </View>
    );
  }

  async function takePhoto() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
    if (photo) setPhotoUri(photo.uri);
  }

  async function pickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  if (photoUri) {
    return (
      <View style={[styles.center, { paddingBottom: insets.bottom + 16 }]}>
        <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="contain" />
        <Button title="Retake" onPress={() => setPhotoUri(null)} />
        {/* Next step: "Use this photo" will upload it */}
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <CameraView ref={cameraRef} style={styles.flex} facing="back" />
      <View style={[styles.bar, { paddingBottom: insets.bottom + 16 }]}>
        <Button title="Gallery" onPress={pickFromGallery} />
        <Button title="Take photo" onPress={takePhoto} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  msg: { fontSize: 16, textAlign: 'center' },
  preview: { width: '100%', height: '75%' },
  bar: { flexDirection: 'row', justifyContent: 'space-around', padding: 16, backgroundColor: '#000' },
});