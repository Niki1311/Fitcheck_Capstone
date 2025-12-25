// App.js – FitCheck OpenAI client (Final Polished Version)
import * as React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Text,
  View,
  TextInput,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
  Modal,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
// Use legacy import to avoid SDK 54 warning
import * as FileSystem from 'expo-file-system/legacy'; 
import AsyncStorage from "@react-native-async-storage/async-storage";

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BACKEND_URL = "http://10.228.248.210:8000";
const PRIMARY = "#37113d";

const AuthContext = React.createContext();

// ---------- SHARED COMPONENTS ----------

function PrimaryButton({ title, onPress, style, textStyle }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.primaryButton, style]}>
      <Text style={[styles.primaryButtonText, textStyle]}>{title}</Text>
    </TouchableOpacity>
  );
}

function HeaderBar({ title, showBack, onBack, showSignOut, onSignOut }) {
  return (
    <View style={styles.headerBar}>
      <View style={styles.headerLeft}>
        {showBack ? (
          <TouchableOpacity onPress={onBack} style={styles.headerIconButton}>
            <Text style={styles.headerIconText}>‹ Back</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerRight}>
        {showSignOut ? (
          <TouchableOpacity onPress={onSignOut} style={styles.headerIconButton}>
            <Text style={[styles.headerIconText, { color: "#d9534f" }]}>
              Sign out
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 70 }} />
        )}
      </View>
    </View>
  );
}

// ---------- LOGIN ----------
function LoginScreen() {
  const { signIn, signUp } = React.useContext(AuthContext);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const validate = () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Enter username and password");
      return false;
    }
    return true;
  };

  return (
    <SafeAreaView style={styles.loginContainer}>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text style={styles.appTitle}>FitCheck</Text>
        <Text style={styles.subtitle}>Your personal AI stylist</Text>

        <TextInput
          style={styles.input}
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <PrimaryButton
          title="Login"
          onPress={async () => {
            if (!validate()) return;
            setLoading(true);
            await signIn(username.trim(), password.trim());
            setLoading(false);
          }}
          style={{ marginTop: 8 }}
        />
        <PrimaryButton
          title="Sign Up"
          onPress={async () => {
            if (!validate()) return;
            setLoading(true);
            await signUp(username.trim(), password.trim());
            setLoading(false);
          }}
          style={{ marginTop: 8, backgroundColor: "white", borderWidth: 1 }}
          textStyle={{ color: PRIMARY }}
        />
        {loading && <ActivityIndicator style={{ marginTop: 10 }} />}
      </View>
    </SafeAreaView>
  );
}

// ---------- HOME ----------
function HomeScreen({ navigation }) {
  const { signOut } = React.useContext(AuthContext);

  return (
    <SafeAreaView style={styles.container}>
      <HeaderBar
        title="FitCheck"
        showBack={false}
        showSignOut={true}
        onSignOut={signOut}
      />
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text style={styles.homeTitle}>
          Hey there, what's your fit gonna be today?
        </Text>

        <PrimaryButton
          title="Take me to my wardrobe"
          onPress={() => navigation.navigate("Wardrobe", { selectionMode: false })}
          style={{ marginTop: 20, width: "80%" }}
        />
        <PrimaryButton
          title="Generate my fit for today"
          onPress={() => navigation.navigate("Recommendations")}
          style={{ marginTop: 12, width: "80%" }}
        />

        <View style={{ marginTop: 40 }}>
          <Image
            source={require("./assets/logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

// ---------- WARDROBE ----------
function WardrobeScreen({ navigation, route }) {
  const { token, signOut } = React.useContext(AuthContext);
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  
  const isSelectionMode = route.params?.selectionMode || false;

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/items`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        Alert.alert("Session expired");
        signOut();
        return;
      }
      const data = await res.json();
      if (navigation.isFocused()) {
        setItems(Array.isArray(data) ? data : data.items || []);
      }
    } catch (err) {
      Alert.alert("Error fetching items");
    } finally {
      if (navigation.isFocused()) {
        setLoading(false);
      }
    }
  };

  React.useEffect(() => {
    const unsub = navigation.addListener("focus", fetchItems);
    return unsub;
  }, [navigation]);

  const handleItemPress = (item) => {
    if (isSelectionMode) {
      navigation.navigate("Recommendations", { selectedWardrobeItem: item });
    } else {
      navigation.navigate("ItemDetail", { item });
    }
  };

  const renderGridItem = ({ item }) => {
    const label =
      item.name ||
      `${(item.color || "").toString()} ${(
        item.category || "item"
      ).toString()}`.trim() ||
      "Item";

    return (
      <TouchableOpacity
        style={styles.gridItem}
        onPress={() => handleItemPress(item)}
      >
        <Image source={{ uri: item.image_url }} style={styles.image} />
        <Text style={styles.itemNameText} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.itemMetaText}>
          {item.category} · {item.color}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <HeaderBar
        title={isSelectionMode ? "Pick a Base Item" : "Wardrobe"}
        showBack={true}
        onBack={() => navigation.goBack()}
        showSignOut={!isSelectionMode}
        onSignOut={signOut}
      />

      {loading ? (
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={items}
          renderItem={renderGridItem}
          keyExtractor={(item, idx) => `${item.image_url}-${idx}`}
          numColumns={2}
          contentContainerStyle={{ paddingBottom: 20, paddingHorizontal: 8 }}
        />
      )}

      {!isSelectionMode && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <PrimaryButton
            title="➕ Add Item"
            onPress={() => navigation.navigate("Add Item")}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------- ITEM DETAIL ----------
function ItemDetailScreen({ route, navigation }) {
  const { signOut } = React.useContext(AuthContext);
  const { token } = React.useContext(AuthContext);
  const { item } = route.params;
  const [deleting, setDeleting] = React.useState(false);

  const label =
    item.name ||
    `${(item.color || "").toString()} ${(
      item.category || "item"
    ).toString()}`.trim() ||
    "Item";

  const handleDelete = async () => {
    Alert.alert("Delete item", "Are you sure you want to delete this item?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            setDeleting(true);
            const fd = new FormData();
            fd.append("image_url", item.image_url);

            const res = await fetch(`${BACKEND_URL}/delete-item`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
              body: fd,
            });
            if (!res.ok) throw new Error("Delete failed");
            navigation.goBack();
          } catch (err) {
            Alert.alert("Delete failed", String(err));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <HeaderBar
        title="Item Details"
        showBack={true}
        onBack={() => navigation.goBack()}
        showSignOut={true}
        onSignOut={signOut}
      />
      <ScrollView contentContainerStyle={{ padding: 16, alignItems: "center" }}>
        <Image source={{ uri: item.image_url }} style={styles.detailImage} />
        <Text style={styles.detailTitle}>{label}</Text>
        <Text style={styles.detailMeta}>
          {item.category} · {item.color}
        </Text>
        {item.material || item.texture ? (
          <Text style={styles.detailMeta}>
            {item.material} {item.texture ? `· ${item.texture}` : ""}
          </Text>
        ) : null}
        {item.formality ? (
          <Text style={styles.detailMeta}>Formality: {item.formality}</Text>
        ) : null}

        <PrimaryButton
          title={deleting ? "Deleting..." : "Delete this item"}
          onPress={handleDelete}
          style={{ marginTop: 24, backgroundColor: "#d9534f" }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- ADD ITEM ----------
function AddItemScreen({ navigation }) {
  const { token } = React.useContext(AuthContext);
  const [name, setName] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [imageUri, setImageUri] = React.useState("");

  const handlePhotoUpload = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Camera permission required");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });
    if (res.canceled) return;

    const uri = res.assets[0].uri;
    setImageUri(uri);
    setUploading(true);
    try {
      const file = {
        uri,
        type: "image/jpeg",
        name: "photo.jpg",
      };
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name.trim() || "Unnamed");

      const r = await fetch(`${BACKEND_URL}/add-item`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!r.ok) {
        const errText = await r.text();
        throw new Error(errText || "Upload failed");
      }
      Alert.alert("Saved!", "Item added successfully.");
      navigation.goBack();
    } catch (err) {
      Alert.alert("Error", String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <HeaderBar
        title="Add Item"
        showBack={true}
        onBack={() => navigation.goBack()}
        showSignOut={false}
      />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <TextInput
          style={styles.input}
          placeholder="Name (optional)"
          value={name}
          onChangeText={setName}
        />
        <PrimaryButton
          title="📷 Take Photo & Upload"
          onPress={handlePhotoUpload}
        />
        {uploading && <ActivityIndicator style={{ marginTop: 10 }} />}
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.image} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- RECOMMENDATIONS ----------
function RecommendationsScreen({ navigation, route }) {
  const { token } = React.useContext(AuthContext);
  const [prompt, setPrompt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [coords, setCoords] = React.useState(null);
  
  const [cameraModalVisible, setCameraModalVisible] = React.useState(false);
  const isMounted = React.useRef(true);

  React.useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      setLoading(false); 
    };
  }, []);

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
       // Optional cleanup
    });
    return unsubscribe;
  }, [navigation]);

  React.useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      if (isMounted.current) {
        setCoords({
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
        });
      }
    })();
  }, []);

  React.useEffect(() => {
    if (route.params?.selectedWardrobeItem) {
      const item = route.params.selectedWardrobeItem;
      navigation.setParams({ selectedWardrobeItem: null });
      handleWardrobeSelection(item);
    }
  }, [route.params?.selectedWardrobeItem]);

  const generateFromPrompt = async () => {
    setLoading(true);
    try {
      const body = { prompt };
      if (coords) {
        body.lat = coords.lat;
        body.lon = coords.lon;
      }
      const res = await fetch(`${BACKEND_URL}/outfit/from-prompt`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!isMounted.current) return;

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");

      navigation.navigate("RecommendationResult", {
        outfit: data.selected_items || [],
        overallReason: data.overall_reason || "",
        weatherSummary: data.weather_summary || "",
        weatherWarning: data.weather_warning || "",
      });
      setPrompt("");
    } catch (err) {
      if (isMounted.current) Alert.alert("Failed", String(err));
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const handleWardrobeSelection = async (item) => {
    setCameraModalVisible(false);
    setLoading(true);
    try {
      const body = { 
        prompt: prompt,
        base_image_url: item.image_url 
      };

      if (coords) {
        body.lat = coords.lat;
        body.lon = coords.lon;
      }

      const res = await fetch(`${BACKEND_URL}/outfit/from-prompt`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!isMounted.current) return;

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");

      navigation.navigate("RecommendationResult", {
        outfit: data.selected_items || [],
        overallReason: data.overall_reason || "",
        weatherSummary: data.weather_summary || "",
        weatherWarning: data.weather_warning || "",
      });
      setPrompt("");
      
    } catch (err) {
      if (isMounted.current) Alert.alert("Error", String(err));
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const handleLaunchCamera = async () => {
    // FIX: Do NOT close modal here. It interrupts the native camera transition.
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Camera permission required");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });
    
    // FIX: Close modal NOW, after camera returns
    setCameraModalVisible(false);
    
    if (res.canceled) return;
    
    setLoading(true);
    try {
      const file = {
        uri: res.assets[0].uri,
        type: "image/jpeg",
        name: "base.jpg",
      };
      const fd = new FormData();
      fd.append("file", file);
      fd.append("prompt", prompt);

      if (coords) {
        fd.append("lat", String(coords.lat));
        fd.append("lon", String(coords.lon));
      }

      const r = await fetch(`${BACKEND_URL}/outfit/from-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      if (!isMounted.current) return;

      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Request failed");

      navigation.navigate("RecommendationResult", {
        outfit: data.selected_items || [],
        overallReason: data.overall_reason || "",
        weatherSummary: data.weather_summary || "",
        weatherWarning: data.weather_warning || "",
      });
      setPrompt("");
    } catch (err) {
      if (isMounted.current) Alert.alert("Failed", String(err));
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <HeaderBar
        title="Fit Prompt"
        showBack={true}
        onBack={() => navigation.goBack()}
        showSignOut={false}
      />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.sectionTitle}>
          Tell me what you're dressing for
        </Text>
        <TextInput
          style={[styles.input, { minHeight: 60 }]}
          placeholder="E.g. brunch date in summer, cozy movie night, job interview..."
          value={prompt}
          multiline
          onChangeText={setPrompt}
        />

        <PrimaryButton
          title="✨ Generate Outfit from Prompt"
          onPress={generateFromPrompt}
          style={{ marginTop: 10 }}
        />
        
        <PrimaryButton
          title="📷 Complete Outfit from Photo"
          onPress={() => setCameraModalVisible(true)}
          style={{ marginTop: 10 }}
        />

        {loading && (
          <ActivityIndicator style={{ marginTop: 20 }} size="large" />
        )}
      </ScrollView>

      {/* --- AESTHETIC CAMERA OVERLAY --- */}
      <Modal 
        visible={cameraModalVisible} 
        transparent={true} 
        animationType="slide"
        onRequestClose={() => setCameraModalVisible(false)}
      >
        <View style={styles.cameraOverlayContainer}>
          {/* Top Left Close X */}
          <TouchableOpacity 
            style={styles.cameraCloseBtn} 
            onPress={() => setCameraModalVisible(false)}
          >
            <Text style={styles.cameraCloseText}>✕</Text>
          </TouchableOpacity>

          <View style={styles.cameraControls}>
            {/* LEFT: Choose from Wardrobe */}
            <TouchableOpacity 
              style={[styles.wardrobePickerBtn, { width: 80 }]}
              onPress={() => {
                setCameraModalVisible(false);
                navigation.navigate("Wardrobe", { selectionMode: true });
              }}
            >
               <View style={styles.wardrobeIconInner}>
                 <Text style={{fontSize: 20}}>🧥</Text>
               </View>
               <Text style={styles.controlLabel}>Choose from{"\n"}Wardrobe</Text>
            </TouchableOpacity>

            {/* CENTER: Shutter Button */}
            <TouchableOpacity 
              style={styles.shutterBtnOuter} 
              onPress={handleLaunchCamera}
            >
              <View style={styles.shutterBtnInner} />
            </TouchableOpacity>

             {/* RIGHT: Back Button */}
            <TouchableOpacity 
              style={[styles.wardrobePickerBtn, { width: 80 }]}
              onPress={() => setCameraModalVisible(false)}
            >
               <View style={styles.wardrobeIconInner}>
                 <Text style={{fontSize: 20}}>↩️</Text>
               </View>
               <Text style={styles.controlLabel}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ---------- OUTFIT CARD ----------
function OutfitCard({ item }) {
  const [expanded, setExpanded] = React.useState(false);

  const label =
    item.name ||
    `${(item.color || "").toString()} ${(
      item.category || "item"
    ).toString()}`.trim() ||
    "Item";
  const shortReason = item.reason || "";

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <TouchableOpacity
      style={[styles.outfitCard, expanded && styles.outfitCardExpanded]}
      onPress={toggleExpand}
      activeOpacity={0.9}
    >
      <View style={styles.imageContainer}>
        <Image source={{ uri: item.image_url }} style={styles.outfitImage} />
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{item.category || "Piece"}</Text>
        </View>
      </View>

      <View style={styles.cardContent}>
        <Text style={styles.outfitItemTitle} numberOfLines={1}>
          {label}
        </Text>
        
        {shortReason ? (
          <View style={styles.reasonContainer}>
            <View style={styles.divider} />
            <Text
              style={styles.outfitItemReason}
              numberOfLines={expanded ? 0 : 3}
            >
              {shortReason}
            </Text>
            {!expanded && (
               <Text style={styles.readMoreText}>Tap to read more</Text>
            )}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ---------- RECOMMENDATION RESULT ----------
function RecommendationResultScreen({ route, navigation }) {
  const { outfit, overallReason, weatherSummary, weatherWarning } =
    route.params;

  const reasonPoints = React.useMemo(() => {
    if (!overallReason) return [];
    const trimmed = overallReason.replace(/\s+/g, " ").trim();
    const parts = trimmed.split(/[.;]/).map((p) => p.trim());
    return parts.filter((p) => p.length > 0).slice(0, 6); 
  }, [overallReason]);

  const renderReasonPoint = ({ item }) => (
    <View style={styles.insightRow}>
      <View style={styles.insightBullet} />
      <Text style={styles.insightText}>{item}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <HeaderBar
        title="Curated Look"
        showBack={true}
        // FIX: Pop to top to reset everything
        onBack={() => navigation.popToTop()}
        showSignOut={false}
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {outfit.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              No outfit could be generated. Try adjusting your prompt or adding
              more items to your wardrobe.
            </Text>
          </View>
        ) : (
          <>
            {(weatherSummary || weatherWarning) && (
              <View style={styles.weatherWidget}>
                {weatherWarning ? (
                  <View style={styles.warningSection}>
                    <Text style={styles.widgetIcon}>⚠️</Text>
                    <Text style={styles.warningText}>{weatherWarning}</Text>
                  </View>
                ) : null}
                
                {weatherSummary ? (
                  <View style={styles.weatherSection}>
                    <Text style={styles.widgetIcon}>🌤️</Text>
                    <Text style={styles.weatherText}>{weatherSummary}</Text>
                  </View>
                ) : null}
              </View>
            )}

            <Text style={styles.sectionHeader}>The Selection</Text>
            
            <View style={styles.masonryContainer}>
              {outfit.map((item, idx) => (
                <OutfitCard key={`${item.image_url}-${idx}`} item={item} />
              ))}
            </View>

            {reasonPoints.length > 0 && (
              <View style={styles.insightContainer}>
                <Text style={styles.sectionHeader}>Stylist Notes</Text>
                <View style={styles.insightCard}>
                  <FlatList
                    data={reasonPoints}
                    keyExtractor={(item, idx) => `reason-${idx}`}
                    renderItem={renderReasonPoint}
                    scrollEnabled={false}
                  />
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- NAVIGATION ----------
const Stack = createNativeStackNavigator();

export default function App() {
  const [token, setToken] = React.useState(null);
  const [booting, setBooting] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      const t = await AsyncStorage.getItem("token");
      if (t) setToken(t);
      setBooting(false);
    })();
  }, []);

  const auth = {
    token,
    signIn: async (username, password) => {
      try {
        const res = await fetch(`${BACKEND_URL}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ username, password }).toString(),
        });
        const data = await res.json();
        if (!data.access_token) throw new Error("Login failed");
        await AsyncStorage.setItem("token", data.access_token);
        setToken(data.access_token);
      } catch (e) {
        Alert.alert("Login failed", e.message);
      }
    },
    signUp: async (username, password) => {
      try {
        const res = await fetch(`${BACKEND_URL}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ username, password }).toString(),
        });
        const data = await res.json();
        if (!data.access_token) throw new Error("Signup failed");
        await AsyncStorage.setItem("token", data.access_token);
        setToken(data.access_token);
      } catch (e) {
        Alert.alert("Signup failed", e.message);
      }
    },
    signOut: async () => {
      setToken(null);
      await AsyncStorage.removeItem("token");
    },
  };

  if (booting) return <ActivityIndicator style={{ flex: 1 }} />;

  return (
    <AuthContext.Provider value={auth}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {token ? (
            <>
              <Stack.Screen name="Home" component={HomeScreen} />
              <Stack.Screen name="Wardrobe" component={WardrobeScreen} />
              <Stack.Screen name="ItemDetail" component={ItemDetailScreen} />
              <Stack.Screen name="Add Item" component={AddItemScreen} />
              <Stack.Screen
                name="Recommendations"
                component={RecommendationsScreen}
              />
              <Stack.Screen
                name="RecommendationResult"
                component={RecommendationResultScreen}
              />
            </>
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </AuthContext.Provider>
  );
}

// ---------- STYLES ----------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  loginContainer: {
    flex: 1,
    backgroundColor: "#f9f5ff",
    paddingHorizontal: 16,
  },

  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
    backgroundColor: "#fff",
  },
  headerLeft: { flex: 1 },
  headerRight: { flex: 1, alignItems: "flex-end" },
  headerTitle: {
    flex: 2,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: PRIMARY,
  },
  headerIconButton: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  headerIconText: {
    fontSize: 14,
    color: PRIMARY,
  },

  appTitle: {
    fontSize: 30,
    fontWeight: "800",
    textAlign: "center",
    color: PRIMARY,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    color: "#666",
    marginBottom: 20,
  },

  homeTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 24,
    color: PRIMARY,
  },

  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    width: "100%",
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: "#fff",
  },

  primaryButton: {
    backgroundColor: PRIMARY,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: PRIMARY,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },

  gridItem: {
    flex: 1,
    margin: 6,
    padding: 10,
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  image: {
    width: 150,
    height: 150,
    borderRadius: 12,
    marginBottom: 8,
  },
  itemNameText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    color: PRIMARY,
  },
  itemMetaText: {
    fontSize: 12,
    textAlign: "center",
    color: "#555",
    marginTop: 2,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    color: PRIMARY,
  },
  
  logo: {
    width: 220,
    height: 120,
  },

  detailImage: {
    width: "90%",
    aspectRatio: 1,
    borderRadius: 16,
    marginBottom: 16,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: PRIMARY,
    textAlign: "center",
    marginBottom: 6,
  },
  detailMeta: {
    fontSize: 13,
    color: "#555",
    textAlign: "center",
    marginBottom: 4,
  },

  // --- NEW AESTHETIC STYLES ---

  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  sectionHeader: {
    fontSize: 20,
    fontWeight: "800",
    color: PRIMARY,
    marginTop: 24,
    marginBottom: 12,
    letterSpacing: 0.5,
  },

  masonryContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },

  outfitCard: {
    width: "48%", 
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: "#fff",
    shadowColor: "#37113d",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    overflow: 'hidden',
  },
  outfitCardExpanded: {
    borderColor: PRIMARY,
    borderWidth: 1,
  },
  imageContainer: {
    position: 'relative',
  },
  outfitImage: {
    width: "100%",
    aspectRatio: 0.85, 
    backgroundColor: '#eee',
  },
  categoryBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  categoryText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cardContent: {
    padding: 12,
  },
  outfitItemTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 8,
  },
  outfitItemReason: {
    fontSize: 13,
    lineHeight: 18,
    color: "#555",
  },
  readMoreText: {
    fontSize: 11,
    color: PRIMARY,
    marginTop: 6,
    fontWeight: '600',
  },

  // --- WEATHER WIDGET ---
  weatherWidget: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: PRIMARY,
  },
  weatherSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  warningSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  widgetIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  weatherText: {
    flex: 1,
    fontSize: 14,
    color: "#333",
    fontWeight: '500',
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: "#d9534f",
    fontWeight: "600",
  },

  // --- INSIGHTS / REASONING ---
  insightCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  insightRow: {
    flexDirection: 'row',
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  insightBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PRIMARY,
    marginTop: 7,
    marginRight: 10,
  },
  insightText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: "#444",
  },

  // --- EMPTY STATES ---
  emptyState: {
    marginTop: 40,
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#888',
    fontSize: 16,
  },

  // --- INSTAGRAM-STYLE CAMERA OVERLAY ---
  cameraOverlayContainer: {
    position: 'absolute',
    top: 0, 
    left: 0, 
    right: 0, 
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)', 
    justifyContent: 'flex-end',
    zIndex: 999,
  },
  cameraCloseBtn: {
    position: 'absolute',
    top: 50,
    left: 20,
    padding: 10,
  },
  cameraCloseText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  cameraControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  
  shutterBtnOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 5,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterBtnInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },

  wardrobePickerBtn: {
    alignItems: 'center',
    // Removed fixed width here so we can override it in JSX with style props
  },
  wardrobeIconInner: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    marginBottom: 6,
  },
  controlLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});