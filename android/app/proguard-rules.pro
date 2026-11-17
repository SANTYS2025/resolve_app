# Reglas de R8/ProGuard para Resolve Pasto.
#
# La app es un WebView de Capacitor: casi todo el código de negocio vive en JS.
# Lo que hay que preservar es el puente Java↔JS, los plugins de Capacitor y
# Firebase Cloud Messaging (push). Los AAR de Capacitor y Firebase traen sus
# propias reglas de consumidor; estas son el respaldo explícito.

# ── Atributos necesarios para depurar y para la reflexión de anotaciones ──
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# ── Capacitor: puente JS y plugins ──
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
}

# ── Plugins nativos usados por la app ──
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.getcapacitor.community.** { *; }
-keep class io.capawesome.** { *; }

# ── Firebase / FCM ──
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# ── Cordova (algunos plugins se cargan por nombre) ──
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# ── WebView y JavaScript ──
-keepclassmembers class * {
    public void evaluateJavascript(java.lang.String, android.webkit.ValueCallback);
}

# ── Serialización / modelos reflejados por nombre ──
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    !static !transient <fields>;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ── Código de la app ──
-keep class co.resolve.pasto.** { *; }

# ── Ruido conocido de dependencias (no afecta a la app) ──
-dontwarn javax.annotation.**
-dontwarn kotlin.**
-dontwarn org.jetbrains.annotations.**
