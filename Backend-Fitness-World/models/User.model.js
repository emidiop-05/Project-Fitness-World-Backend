const { Schema, model } = require("mongoose");
const bcrypt = require("bcrypt");
const countries = require("i18n-iso-countries");

countries.registerLocale(require("i18n-iso-countries/langs/en.json"));

const userSchema = new Schema(
  {
    profileImage: {
      type: String,
      required: false,
      default: "https://via.placeholder.com/150",
    },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    nickName: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    birthday: { type: Date, required: true },
    gender: { type: String, enum: ["male", "female", "other"], required: true },

    countryCode: {
      type: String,
      uppercase: true,
      trim: true,
      validate: {
        validator: (val) => !!countries.getName(val, "en"),
        message: (props) => `"${props.value}" is not a valid ISO country code`,
      },
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = model("User", userSchema);
